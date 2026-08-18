const API_BASE =
  'https://www.eustat.eus/bankupx/api/v1/es/DB';

const CATALOG_URL = './data/index_es.json';

const app = document.querySelector('#app');

let catalog = [];

let state = {
  table: null,
  metadata: null,
  selections: {},
  result: null
};


/* =========================================================
   UTILIDADES
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}


function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  if (typeof value === 'number') {
    return value.toLocaleString('es-ES', {
      maximumFractionDigits: 15
    });
  }

  return String(value);
}


function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('es-ES');
}


/*
 * Algunos códigos de periodo pueden ser:
 *
 * 2025
 * 2025-1
 * 2025-01
 * 2025T1
 * 2025M01
 *
 * Esta función intenta extraer el año para poder
 * ordenar de más reciente a más antiguo.
 */
function timeSortValue(value) {
  const text = String(value);

  const year = text.match(/^(\d{4})/);

  if (!year) {
    return null;
  }

  const yearNumber = Number(year[1]);

  const rest = text.slice(4);

  /*
   * Si hay trimestre/mes/número posterior al año,
   * también intentamos utilizarlo.
   */
  const number = rest.match(/(\d+)/);

  const subPeriod =
    number
      ? Number(number[1])
      : 0;

  return (
    yearNumber * 1000 +
    subPeriod
  );
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

async function loadCatalog() {
  const response =
    await fetch(CATALOG_URL);

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar el catálogo (${response.status})`
    );
  }

  const json =
    await response.json();

  catalog =
    Array.isArray(json.data)
      ? json.data
      : Array.isArray(json)
        ? json
        : [];
}


/* =========================================================
   API EUSTAT
   ========================================================= */

async function getMetadata(id) {
  const response =
    await fetch(
      `${API_BASE}/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `No se pudieron obtener los metadatos (${response.status})`
    );
  }

  return response.json();
}


async function postQuery(id, query) {
  const response =
    await fetch(
      `${API_BASE}/${encodeURIComponent(id)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          query,
          response: {
            format: 'json-stat'
          }
        })
      }
    );

  if (!response.ok) {
    const text =
      await response.text().catch(() => '');

    throw new Error(
      `La API respondió HTTP ${response.status}` +
      (text ? `: ${text}` : '')
    );
  }

  return response.json();
}


/* =========================================================
   VARIABLES DE EUSTAT
   ========================================================= */

function getVariableValues(variable) {
  const codes =
    Array.isArray(variable.values)
      ? variable.values
      : [];

  const labels =
    Array.isArray(variable.valueTexts)
      ? variable.valueTexts
      : [];

  return codes.map((code, index) => ({
    code: String(code),
    label:
      labels[index] !== undefined
        ? String(labels[index])
        : String(code),
    originalIndex: index
  }));
}


/*
 * Orden visual de las categorías.
 *
 * IMPORTANTE:
 *
 * Solo cambiamos el orden en la interfaz.
 * Los códigos siguen siendo los códigos originales
 * de Eustat.
 *
 * Si variable.time === true:
 *     más reciente → más antiguo
 *
 * Si no:
 *     mantenemos el orden original de Eustat.
 */
function getDisplayValues(variable) {
  const values =
    getVariableValues(variable);

  if (!variable.time) {
    return values;
  }

  const sorted =
    [...values].sort((a, b) => {

      const aTime =
        timeSortValue(a.code);

      const bTime =
        timeSortValue(b.code);

      /*
       * Si no podemos interpretar los valores como
       * periodos, mantenemos el orden original.
       */
      if (
        aTime === null ||
        bTime === null
      ) {
        return a.originalIndex - b.originalIndex;
      }

      /*
       * DESCENDENTE:
       * 2025
       * 2024
       * 2023
       * ...
       */
      return bTime - aTime;
    });

  return sorted;
}


/* =========================================================
   SELECCIONES
   ========================================================= */

function initializeSelections(metadata) {
  const selections = {};

  for (const variable of metadata.variables || []) {

    const values =
      getVariableValues(variable);

    /*
     * Inicialmente seleccionamos el primer valor
     * disponible, que es el comportamiento que
     * queremos para que una tabla no llegue vacía
     * al abrirla.
     */
    selections[variable.code] =
      values.length
        ? [values[0].code]
        : [];
  }

  return selections;
}


function getSelected(variableCode) {
  return state.selections[variableCode] || [];
}


function setSelected(variableCode, values) {
  state.selections[variableCode] =
    values.map(String);
}


/* =========================================================
   CONSTRUIR QUERY
   ========================================================= */

/*
 * Esta es una de las partes importantes.
 *
 * NO conocemos de antemano las variables.
 *
 * Leemos las que devuelve Eustat y construimos
 * el query dinámicamente.
 */
function buildQuery() {

  const query = [];

  for (
    const variable
    of state.metadata.variables || []
  ) {

    const selected =
      getSelected(variable.code);

    /*
     * Si el usuario no ha seleccionado nada,
     * no mandamos la consulta.
     */
    if (!selected.length) {
      continue;
    }

    query.push({
      code: variable.code,

      selection: {
        filter: 'item',
        values: selected
      }
    });
  }

  return query;
}


/* =========================================================
   JSON-STAT 1.2
   ========================================================= */

/*
 * Eustat devuelve:
 *
 * {
 *   "dataset": {
 *      ...
 *   }
 * }
 */
function getDataset(response) {

  if (
    response &&
    response.dataset &&
    typeof response.dataset === 'object'
  ) {
    return response.dataset;
  }

  /*
   * Permitimos también una respuesta JSON-stat
   * sin wrapper.
   */
  return response;
}


/*
 * Convierte:
 *
 * category.index
 *
 * en una lista ordenada.
 *
 * Ejemplo:
 *
 * {
 *   "2021": 0,
 *   "2022": 1,
 *   "2023": 2
 * }
 *
 * →
 *
 * [
 *   { code: "2021", index: 0 },
 *   { code: "2022", index: 1 },
 *   { code: "2023", index: 2 }
 * ]
 */
function parseCategoryIndex(category) {

  if (!category || !category.index) {
    return [];
  }

  const index =
    category.index;

  if (Array.isArray(index)) {

    return index.map(
      (code, position) => ({
        code: String(code),
        index: position
      })
    );
  }

  if (typeof index === 'object') {

    return Object.entries(index)
      .map(([code, position]) => ({
        code: String(code),
        index: Number(position)
      }))
      .filter(
        item =>
          Number.isFinite(item.index)
      )
      .sort(
        (a, b) =>
          a.index - b.index
      );
  }

  return [];
}


/*
 * Lee una dimensión completa.
 */
function parseDimension(id, dimension) {

  const category =
    dimension.category || {};

  const labels =
    category.label &&
    typeof category.label === 'object'
      ? category.label
      : {};

  const indexed =
    parseCategoryIndex(category);


  const categories =
    indexed.map(item => ({
      code: item.code,

      label:
        labels[item.code] !== undefined
          ? String(labels[item.code])
          : item.code,

      index: item.index
    }));


  return {
    id,
    label:
      dimension.label || id,

    categories,

    extension:
      dimension.extension || {}
  };
}


/*
 * Lee las dimensiones en el orden indicado por
 * dataset.id.
 *
 * Esto es fundamental para JSON-stat:
 *
 * id + size + value
 *
 * determinan la posición de cada observación.
 */
function parseDimensions(dataset) {

  const ids =
    Array.isArray(dataset.id)
      ? dataset.id.map(String)
      : Object.keys(
          dataset.dimension || {}
        );


  return ids.map(id => {

    const dimension =
      dataset.dimension?.[id];

    if (!dimension) {
      throw new Error(
        `No se encontró la dimensión "${id}".`
      );
    }

    return parseDimension(
      id,
      dimension
    );
  });
}


/*
 * Convierte una posición plana del array value
 * en las posiciones de cada dimensión.
 *
 * Ejemplo:
 *
 * size = [2, 3]
 *
 * value[0] → [0,0]
 * value[1] → [0,1]
 * value[2] → [0,2]
 * value[3] → [1,0]
 * ...
 */
function flatIndexToCoordinates(
  flatIndex,
  sizes
) {

  const coordinates =
    new Array(sizes.length);

  let remainder =
    flatIndex;


  for (
    let i = sizes.length - 1;
    i >= 0;
    i--
  ) {

    const size =
      Number(sizes[i]);

    if (
      !Number.isFinite(size) ||
      size <= 0
    ) {
      coordinates[i] = 0;
      continue;
    }

    coordinates[i] =
      remainder % size;

    remainder =
      Math.floor(
        remainder / size
      );
  }

  return coordinates;
}


/*
 * Parser principal.
 *
 * Devuelve:
 *
 * {
 *   dimensions,
 *   rows
 * }
 */
function parseJsonStat(response) {

  const dataset =
    getDataset(response);


  if (!dataset) {
    throw new Error(
      'La respuesta JSON-stat está vacía.'
    );
  }


  if (
    !dataset.id ||
    !dataset.size ||
    !dataset.dimension
  ) {
    throw new Error(
      'La respuesta no tiene una estructura JSON-stat reconocible.'
    );
  }


  const dimensions =
    parseDimensions(dataset);


  const sizes =
    dataset.size.map(Number);


  const values =
    Array.isArray(dataset.value)
      ? dataset.value
      : [];


  const totalCells =
    sizes.reduce(
      (total, size) =>
        total * size,
      1
    );


  const rows = [];


  /*
   * Recorremos el cubo completo.
   */
  for (
    let flatIndex = 0;
    flatIndex < totalCells;
    flatIndex++
  ) {

    const coordinates =
      flatIndexToCoordinates(
        flatIndex,
        sizes
      );


    const valuesByDimension = {};
    const codesByDimension = {};


    dimensions.forEach(
      (dimension, dimensionIndex) => {

        const position =
          coordinates[dimensionIndex];


        const category =
          dimension.categories.find(
            item =>
              item.index === position
          );


        if (category) {

          valuesByDimension[
            dimension.id
          ] = category.label;

          codesByDimension[
            dimension.id
          ] = category.code;

        } else {

          valuesByDimension[
            dimension.id
          ] = '';

          codesByDimension[
            dimension.id
          ] = '';
        }

      }
    );


    rows.push({

      values:
        valuesByDimension,

      codes:
        codesByDimension,

      value:
        values[flatIndex] !== undefined
          ? values[flatIndex]
          : null,

      index:
        flatIndex

    });
  }


  return {
    dataset,
    dimensions,
    rows
  };
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

function renderCatalog() {

  app.innerHTML = `

    <main class="catalog">

      <div class="catalog-inner">

        <h1>Eustat Statbank</h1>

        <p>
          Explora las tablas estadísticas de Eustat.
        </p>


        <div class="search">

          <input
            id="search"
            type="search"
            placeholder="Buscar tablas..."
            autocomplete="off"
          >

        </div>


        <div class="catalog-layout">

          <aside class="catalog-sidebar">

            <div>
              <strong>Contenido</strong>
            </div>

            <div>
              <strong>Operación estadística</strong>
            </div>

            <div>
              <strong>Frecuencia</strong>
            </div>

            <div>
              <strong>Periodo</strong>
            </div>

          </aside>


          <section>

            <div
              id="catalog-count"
              class="catalog-count">
            </div>

            <div
              id="catalog-results">
            </div>

          </section>

        </div>

      </div>

    </main>
  `;


  const search =
    document.querySelector('#search');


  search.addEventListener(
    'input',
    () => {
      renderCatalogResults(
        search.value
      );
    }
  );


  renderCatalogResults('');
}


function renderCatalogResults(term) {

  const text =
    String(term || '')
      .trim()
      .toLocaleLowerCase('es');


  const results =
    catalog.filter(item => {

      if (!text) {
        return true;
      }

      const searchable =
        [
          item.title,
          item.text,
          item.id,
          item.search_text,
          item.operacion_titulo
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('es');


      return searchable.includes(text);
    });


  const count =
    document.querySelector(
      '#catalog-count'
    );


  if (count) {
    count.textContent =
      `${results.length.toLocaleString('es-ES')} tablas`;
  }


  const container =
    document.querySelector(
      '#catalog-results'
    );


  if (!container) return;


  if (!results.length) {

    container.innerHTML = `
      <div class="empty">
        No se encontraron tablas.
      </div>
    `;

    return;
  }


  container.innerHTML =
    results
      .slice(0, 100)
      .map(item => `

        <article class="table-card">

          <h2>
            ${escapeHtml(
              item.title ||
              item.text ||
              item.id
            )}
          </h2>

          <p class="table-id">
            ${escapeHtml(item.id)}
          </p>

          ${
            item.updated
              ? `
                <p>
                  Actualizada:
                  ${escapeHtml(
                    formatDate(item.updated)
                  )}
                </p>
              `
              : ''
          }

          <a
            href="#/table/${encodeURIComponent(item.id)}"
            class="open-table">

            Abrir tabla →

          </a>

        </article>

      `)
      .join('');
}


/* =========================================================
   TABLA
   ========================================================= */

async function openTable(id) {

  const table =
    catalog.find(
      item => item.id === id
    );


  if (!table) {

    location.hash = '#/';

    return;
  }


  state = {
    table,
    metadata: null,
    selections: {},
    result: null
  };


  app.innerHTML = `

    <main class="catalog">

      <div class="catalog-inner">

        <div class="loading">
          Cargando metadatos...
        </div>

      </div>

    </main>
  `;


  try {

    const metadata =
      await getMetadata(id);


    /*
     * Guardamos los metadatos reales de Eustat.
     */
    state.metadata =
      metadata;


    /*
     * Creamos las selecciones a partir de las
     * variables que realmente tiene esta tabla.
     */
    state.selections =
      initializeSelections(
        metadata
      );


    renderTablePage();


  } catch (error) {

    renderError(
      error
    );
  }
}


/* =========================================================
   INTERFAZ DE TABLA
   ========================================================= */

function renderTablePage() {

  const metadata =
    state.metadata;


  const variables =
    Array.isArray(metadata.variables)
      ? metadata.variables
      : [];


  app.innerHTML = `

    <main class="table-page">

      <div class="table-page-inner">

        <div class="breadcrumbs">

          <a href="#/">
            Tablas
          </a>

          <span>›</span>

          <span>
            ${escapeHtml(
              metadata.title ||
              state.table.title ||
              state.table.id
            )}
          </span>

        </div>


        <h1>
          ${escapeHtml(
            metadata.title ||
            state.table.title ||
            state.table.id
          )}
        </h1>


        <div class="table-layout">

          <aside class="filters">

            <h2>
              Seleccionar datos
            </h2>

            <div id="filters">

              ${
                variables
                  .map(
                    renderVariable
                  )
                  .join('')
              }

            </div>

          </aside>


          <section class="table-results">

            <div class="actions">

              <button
                id="show-data"
                class="primary-button">

                Mostrar tabla

              </button>


              <button
                id="download-csv"
                class="outline-button"
                disabled>

                Descargar CSV

              </button>


              <button
                id="copy-query"
                class="outline-button">

                Copiar consulta API

              </button>

            </div>


            <div
              id="status">
            </div>


            <div
              id="result">

              <div class="table-placeholder">

                Selecciona los valores que quieras
                consultar y pulsa
                <strong>Mostrar tabla</strong>.

              </div>

            </div>

          </section>

        </div>

      </div>

    </main>
  `;


  attachVariableEvents();


  document
    .querySelector('#show-data')
    .addEventListener(
      'click',
      executeQuery
    );


  document
    .querySelector('#download-csv')
    .addEventListener(
      'click',
      downloadCSV
    );


  document
    .querySelector('#copy-query')
    .addEventListener(
      'click',
      copyQuery
    );
}


/* =========================================================
   RENDER VARIABLE
   ========================================================= */

function renderVariable(variable) {

  const values =
    getDisplayValues(variable);


  const selected =
    getSelected(
      variable.code
    );


  const variableId =
    encodeURIComponent(
      variable.code
    );


  return `

    <div
      class="variable"
      data-variable="${escapeHtml(variable.code)}">

      <div class="variable-header">

        <h3>
          ${escapeHtml(
            variable.text ||
            variable.code
          )}
        </h3>

        <span
          class="selection-count"
          id="count-${variableId}">

          ${selected.length}
          / ${values.length}

        </span>

      </div>


      <div class="variable-actions">

        <button
          type="button"
          data-select-all="${escapeHtml(variable.code)}">

          Todos

        </button>


        <button
          type="button"
          data-select-none="${escapeHtml(variable.code)}">

          Ninguno

        </button>

      </div>


      <div class="variable-search">

        <input
          type="search"
          placeholder="Buscar..."
          data-variable-search="${escapeHtml(variable.code)}"
        >

      </div>


      <div
        class="variable-values"
        data-values="${escapeHtml(variable.code)}">

        ${
          values
            .map(item => `

              <label
                class="value-option"
                data-label="${escapeHtml(
                  item.label.toLocaleLowerCase('es')
                )}">

                <input
                  type="checkbox"

                  data-variable="${escapeHtml(
                    variable.code
                  )}"

                  data-code="${escapeHtml(
                    item.code
                  )}"

                  ${
                    selected.includes(item.code)
                      ? 'checked'
                      : ''
                  }
                >

                <span>
                  ${escapeHtml(item.label)}
                </span>

              </label>

            `)
            .join('')
        }

      </div>

    </div>
  `;
}


/* =========================================================
   EVENTOS
   ========================================================= */

function attachVariableEvents() {

  document
    .querySelectorAll(
      '.value-option input[type="checkbox"]'
    )
    .forEach(input => {

      input.addEventListener(
        'change',
        () => {

          const variable =
            input.dataset.variable;

          const code =
            input.dataset.code;


          let selected =
            getSelected(variable);


          if (input.checked) {

            if (!selected.includes(code)) {
              selected.push(code);
            }

          } else {

            selected =
              selected.filter(
                value =>
                  value !== code
              );
          }


          setSelected(
            variable,
            selected
          );


          updateSelectionCount(
            variable
          );
        }
      );
    });


  /*
   * TODOS
   */
  document
    .querySelectorAll(
      '[data-select-all]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const code =
            button.dataset.selectAll;


          const variable =
            state.metadata.variables.find(
              item =>
                item.code === code
            );


          if (!variable) return;


          const values =
            getVariableValues(variable);


          setSelected(
            code,
            values.map(
              item => item.code
            )
          );


          refreshVariable(
            code
          );
        }
      );
    });


  /*
   * NINGUNO
   */
  document
    .querySelectorAll(
      '[data-select-none]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const code =
            button.dataset.selectNone;


          setSelected(
            code,
            []
          );


          refreshVariable(
            code
          );
        }
      );
    });


  /*
   * BUSCAR DENTRO DE UNA VARIABLE
   */
  document
    .querySelectorAll(
      '[data-variable-search]'
    )
    .forEach(input => {

      input.addEventListener(
        'input',
        () => {

          const code =
            input.dataset.variableSearch;


          const term =
            input.value
              .trim()
              .toLocaleLowerCase('es');


          document
            .querySelectorAll(
              `[data-values="${CSS.escape(code)}"] .value-option`
            )
            .forEach(option => {

              const label =
                option.dataset.label || '';


              option.style.display =
                !term ||
                label.includes(term)
                  ? ''
                  : 'none';
            });
        }
      );
    });
}


/* =========================================================
   ACTUALIZAR SELECCIÓN
   ========================================================= */

function updateSelectionCount(
  variableCode
) {

  const variable =
    state.metadata.variables.find(
      item =>
        item.code === variableCode
    );


  if (!variable) return;


  const id =
    `count-${encodeURIComponent(
      variableCode
    )}`;


  const element =
    document.getElementById(id);


  if (!element) return;


  element.textContent =
    `${getSelected(variableCode).length} / ${
      getVariableValues(variable).length
    }`;
}


function refreshVariable(
  variableCode
) {

  const selected =
    getSelected(variableCode);


  document
    .querySelectorAll(
      `input[data-variable="${CSS.escape(variableCode)}"]`
    )
    .forEach(input => {

      input.checked =
        selected.includes(
          input.dataset.code
        );
    });


  updateSelectionCount(
    variableCode
  );
}


/* =========================================================
   EJECUTAR CONSULTA
   ========================================================= */

async function executeQuery() {

  const result =
    document.querySelector(
      '#result'
    );


  const status =
    document.querySelector(
      '#status'
    );


  const button =
    document.querySelector(
      '#show-data'
    );


  const csvButton =
    document.querySelector(
      '#download-csv'
    );


  /*
   * Comprobamos que todas las variables
   * tengan al menos una selección.
   */
  const empty =
    state.metadata.variables
      .filter(variable =>
        getSelected(variable.code).length === 0
      );


  if (empty.length) {

    result.innerHTML = `

      <div class="api-error">

        <strong>
          Faltan selecciones
        </strong>

        <p>
          Selecciona al menos un valor en:
        </p>

        <ul>

          ${
            empty
              .map(
                variable =>
                  `<li>${escapeHtml(
                    variable.text ||
                    variable.code
                  )}</li>`
              )
              .join('')
          }

        </ul>

      </div>

    `;

    return;
  }


  button.disabled = true;

  csvButton.disabled = true;


  result.innerHTML = `

    <div class="loading">
      Consultando Eustat...
    </div>

  `;


  status.innerHTML = '';


  const query =
    buildQuery();


  try {

    const response =
      await postQuery(
        state.table.id,
        query
      );


    const parsed =
      parseJsonStat(response);


    state.result =
      parsed;


    renderResult(
      parsed
    );


    csvButton.disabled = false;


    status.innerHTML = `

      <div class="api-ok">

        Datos obtenidos directamente
        de la API de Eustat.

        ${
          parsed.rows.length.toLocaleString(
            'es-ES'
          )
        }
        observaciones.

      </div>

    `;


  } catch (error) {

    state.result = null;


    result.innerHTML = `

      <div class="api-error">

        <strong>
          Error al consultar Eustat
        </strong>

        <p>
          ${escapeHtml(error.message)}
        </p>


        <details>

          <summary>
            Consulta enviada
          </summary>

          <pre>${escapeHtml(
            JSON.stringify(
              {
                query,
                response: {
                  format: 'json-stat'
                }
              },
              null,
              2
            )
          )}</pre>

        </details>

      </div>

    `;

  } finally {

    button.disabled = false;
  }
}


/* =========================================================
   RENDER RESULTADO
   ========================================================= */

function renderResult(parsed) {

  const result =
    document.querySelector(
      '#result'
    );


  if (!parsed.rows.length) {

    result.innerHTML = `

      <div class="table-placeholder">
        La consulta no ha devuelto datos.
      </div>

    `;

    return;
  }


  /*
   * Tabla genérica:
   *
   * una columna por dimensión
   * + columna Valor
   *
   * Más adelante podremos añadir la vista
   * pivotada estilo Statbank.
   */
  const headers =
    parsed.dimensions
      .map(
        dimension =>
          `<th>${escapeHtml(
            dimension.label
          )}</th>`
      )
      .join('');


  const body =
    parsed.rows
      .map(row => {

        const cells =
          parsed.dimensions
            .map(
              dimension => `
                <td>
                  ${escapeHtml(
                    row.values[
                      dimension.id
                    ]
                  )}
                </td>
              `
            )
            .join('');


        return `

          <tr>

            ${cells}

            <td class="numeric">

              ${escapeHtml(
                formatNumber(
                  row.value
                )
              )}

            </td>

          </tr>

        `;
      })
      .join('');


  result.innerHTML = `

    <div class="result-info">

      <strong>
        ${parsed.rows.length.toLocaleString('es-ES')}
        observaciones
      </strong>

    </div>


    <div class="table-scroll">

      <table class="data-table">

        <thead>

          <tr>

            ${headers}

            <th>
              Valor
            </th>

          </tr>

        </thead>


        <tbody>

          ${body}

        </tbody>

      </table>

    </div>

  `;
}


/* =========================================================
   CONSULTA API
   ========================================================= */

function getQueryObject() {

  return {

    query:
      buildQuery(),

    response: {
      format: 'json-stat'
    }

  };
}


async function copyQuery() {

  const query =
    getQueryObject();


  const text =
    JSON.stringify(
      query,
      null,
      2
    );


  try {

    await navigator.clipboard.writeText(
      text
    );


    showStatus(
      'Consulta copiada al portapapeles.'
    );


  } catch {

    const textarea =
      document.createElement(
        'textarea'
      );


    textarea.value =
      text;


    document.body.appendChild(
      textarea
    );


    textarea.select();

    document.execCommand(
      'copy'
    );


    textarea.remove();


    showStatus(
      'Consulta copiada al portapapeles.'
    );
  }
}


function showStatus(message) {

  const status =
    document.querySelector(
      '#status'
    );


  if (!status) return;


  status.innerHTML = `

    <div class="api-ok">

      ${escapeHtml(message)}

    </div>

  `;


  setTimeout(
    () => {
      status.innerHTML = '';
    },
    2500
  );
}


/* =========================================================
   CSV
   ========================================================= */

function csvEscape(value) {

  const text =
    String(value ?? '');


  if (
    text.includes(';') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {

    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }


  return text;
}


function createCSV() {

  if (!state.result) {
    return '';
  }


  const dimensions =
    state.result.dimensions;


  const header = [

    ...dimensions.map(
      dimension =>
        dimension.label
    ),

    'Valor'

  ];


  const lines = [

    header
      .map(csvEscape)
      .join(';')

  ];


  for (
    const row
    of state.result.rows
  ) {

    const values = [

      ...dimensions.map(
        dimension =>
          row.values[
            dimension.id
          ]
      ),

      row.value

    ];


    lines.push(
      values
        .map(csvEscape)
        .join(';')
    );
  }


  /*
   * BOM UTF-8 para Excel.
   */
  return '\uFEFF' +
    lines.join('\r\n');
}


function downloadCSV() {

  if (!state.result) {
    return;
  }


  const csv =
    createCSV();


  const blob =
    new Blob(
      [csv],
      {
        type:
          'text/csv;charset=utf-8'
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      'a'
    );


  link.href =
    url;


  link.download =
    `${state.table.id.replace(
      /\.px$/i,
      ''
    )}.csv`;


  document.body.appendChild(
    link
  );


  link.click();


  link.remove();


  URL.revokeObjectURL(
    url
  );
}


/* =========================================================
   ERRORES
   ========================================================= */

function renderError(error) {

  app.innerHTML = `

    <main class="catalog">

      <div class="catalog-inner">

        <div class="api-error">

          <strong>
            Se ha producido un error
          </strong>

          <p>
            ${escapeHtml(
              error.message
            )}
          </p>

          <a href="#/">
            ← Volver al catálogo
          </a>

        </div>

      </div>

    </main>

  `;
}


/* =========================================================
   ROUTER
   ========================================================= */

function route() {

  const hash =
    location.hash || '#/';


  const match =
    hash.match(
      /^#\/table\/(.+)$/
    );


  if (match) {

    openTable(
      decodeURIComponent(
        match[1]
      )
    );

    return;
  }


  renderCatalog();
}


/* =========================================================
   INICIO
   ========================================================= */

loadCatalog()

  .then(() => {

    route();

  })

  .catch(error => {

    renderError(
      error
    );

  });


window.addEventListener(
  'hashchange',
  route
);
