const API_BASE =
  'https://www.eustat.eus/bankupx/api/v1/es/DB';

const CATALOG_URL =
  './data/index_es.json';

const app =
  document.querySelector('#app');

let catalog = [];

let state = {
  table: null,
  metadata: null,
  selections: {},
  result: null
};


/* =========================================================
   UTILIDADES GENERALES
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char])
  );
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
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('es-ES');
}


/*
 * Convierte un periodo en un número utilizable para ordenar.
 *
 * Ejemplos:
 *
 * 2025       -> 2025000
 * 2025-1     -> 2025001
 * 2025-01    -> 2025001
 * 2025-12    -> 2025012
 * 2025-2     -> 2025002
 * 2025T1     -> 2025001
 * 2025M12    -> 2025012
 */
function timeSortValue(value) {
  const text =
    String(value ?? '').trim();

  const yearMatch =
    text.match(/^(\d{4})/);

  if (!yearMatch) {
    return null;
  }

  const year =
    Number(yearMatch[1]);

  const rest =
    text.slice(4);

  const numberMatch =
    rest.match(/(\d+)/);

  const subPeriod =
    numberMatch
      ? Number(numberMatch[1])
      : 0;

  return (
    year * 1000 +
    subPeriod
  );
}


/*
 * Fecha de actualización del catálogo.
 *
 * Las tablas más recientemente actualizadas
 * aparecen primero.
 */
function catalogSortValue(item) {
  if (!item || !item.updated) {
    return 0;
  }

  const time =
    Date.parse(item.updated);

  return Number.isFinite(time)
    ? time
    : 0;
}


/*
 * Escapa una cadena para utilizarla como
 * atributo HTML.
 */
function escapeAttribute(value) {
  return escapeHtml(value);
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

async function loadCatalog() {
  const response =
    await fetch(CATALOG_URL, {
      cache: 'no-cache'
    });

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar el catálogo (${response.status})`
    );
  }

  const json =
    await response.json();

  if (Array.isArray(json.data)) {
    catalog = json.data;
  } else if (Array.isArray(json)) {
    catalog = json;
  } else {
    catalog = [];
  }

  /*
   * Ordenamos el catálogo una sola vez:
   *
   * más recientemente actualizada
   * →
   * más antigua
   */
  catalog.sort(
    (a, b) =>
      catalogSortValue(b) -
      catalogSortValue(a)
  );
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
          'Accept': 'application/json'
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `No se pudieron obtener los metadatos (${response.status})${text ? `: ${text}` : ''}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Eustat no devolvió unos metadatos JSON válidos.'
    );
  }
}


async function postQuery(id, query) {
  const payload = {
    query,
    response: {
      format: 'json-stat'
    }
  };

  console.log(
    'EUSTAT REQUEST:',
    payload
  );

  const response =
    await fetch(
      `${API_BASE}/${encodeURIComponent(id)}`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'Accept':
            'application/json'
        },

        body:
          JSON.stringify(payload)
      }
    );

  const text =
    await response.text();

  console.log(
    'EUSTAT HTTP:',
    response.status
  );

  console.log(
    'EUSTAT RESPONSE:',
    text
  );

  if (!response.ok) {
    throw new Error(
      `Eustat respondió HTTP ${response.status}${text ? `: ${text}` : ''}`
    );
  }

  let json;

  try {
    json =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Eustat no devolvió JSON válido.\n\n${text}`
    );
  }

  return json;
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

  return codes.map(
    (code, index) => ({
      code: String(code),

      label:
        labels[index] !== undefined
          ? String(labels[index])
          : String(code),

      originalIndex:
        index
    })
  );
}


/*
 * Orden visual.
 *
 * Para variables temporales:
 *
 * más reciente
 * →
 * más antiguo
 *
 * Para el resto:
 * mantenemos exactamente el orden
 * proporcionado por Eustat.
 */
function getDisplayValues(variable) {
  const values =
    getVariableValues(variable);

  if (!variable.time) {
    return values;
  }

  return [...values].sort(
    (a, b) => {
      const aTime =
        timeSortValue(a.code);

      const bTime =
        timeSortValue(b.code);

      /*
       * Si alguno no se puede interpretar
       * como periodo, conservamos el orden
       * original de Eustat.
       */
      if (
        aTime === null ||
        bTime === null
      ) {
        return (
          a.originalIndex -
          b.originalIndex
        );
      }

      return bTime - aTime;
    }
  );
}


/* =========================================================
   SELECCIONES
   ========================================================= */

function initializeSelections(metadata) {
  const selections = {};

  for (
    const variable
    of metadata.variables || []
  ) {
    const values =
      getDisplayValues(variable);

    /*
     * Para todas las variables seleccionamos
     * el primer valor de Eustat.
     *
     * PERO en variables temporales getDisplayValues()
     * ya está ordenado de más reciente a más antiguo.
     *
     * Por tanto:
     *
     * periodo → último periodo disponible.
     */
    selections[variable.code] =
      values.length
        ? [values[0].code]
        : [];
  }

  return selections;
}


function getSelected(variableCode) {
  return (
    state.selections[variableCode] ||
    []
  );
}


function setSelected(
  variableCode,
  values
) {
  state.selections[variableCode] =
    [...new Set(
      values.map(String)
    )];
}


/* =========================================================
   CONSTRUIR QUERY
   ========================================================= */

function buildQuery() {
  const query = [];

  for (
    const variable
    of state.metadata.variables || []
  ) {
    const selected =
      getSelected(variable.code);

    /*
     * Eustat necesita una selección
     * para cada dimensión.
     */
    if (!selected.length) {
      continue;
    }

    query.push({
      code:
        variable.code,

      selection: {
        filter:
          'item',

        values:
          selected
      }
    });
  }

  return query;
}


function getQueryObject() {
  return {
    query:
      buildQuery(),

    response: {
      format:
        'json-stat'
    }
  };
}


/* =========================================================
   JSON-STAT 1.2
   ========================================================= */

/*
 * Eustat devuelve normalmente:
 *
 * {
 *   "dataset": {
 *      ...
 *   }
 * }
 *
 * También aceptamos un dataset JSON-stat
 * directamente, sin wrapper.
 */
function getDataset(response) {
  if (
    response &&
    typeof response.dataset === 'object' &&
    response.dataset !== null
  ) {
    return response.dataset;
  }

  return response;
}


/*
 * Obtiene el orden de las categorías.
 *
 * JSON-stat puede utilizar:
 *
 * "index": {
 *   "100": 0,
 *   "200": 1
 * }
 *
 * o:
 *
 * "index": [
 *   "100",
 *   "200"
 * ]
 */
function parseCategoryIndex(
  category
) {
  if (
    !category ||
    category.index === undefined ||
    category.index === null
  ) {
    return [];
  }

  const index =
    category.index;

  /*
   * Caso:
   *
   * index: ["100", "200", "300"]
   */
  if (Array.isArray(index)) {
    return index.map(
      (code, position) => ({
        code:
          String(code),

        index:
          position
      })
    );
  }

  /*
   * Caso:
   *
   * index: {
   *   "100": 0,
   *   "200": 1
   * }
   */
  if (
    typeof index === 'object'
  ) {
    return Object.entries(index)
      .map(
        ([code, position]) => ({
          code:
            String(code),

          index:
            Number(position)
        })
      )
      .filter(
        item =>
          Number.isFinite(
            item.index
          )
      )
      .sort(
        (a, b) =>
          a.index -
          b.index
      );
  }

  return [];
}


/*
 * Si una categoría no tiene "index",
 * podemos intentar obtener el orden
 * a partir de sus labels.
 */
function parseCategoriesWithoutIndex(
  category
) {
  if (
    !category ||
    !category.label ||
    typeof category.label !== 'object'
  ) {
    return [];
  }

  return Object.keys(
    category.label
  ).map(
    (code, index) => ({
      code:
        String(code),

      index
    })
  );
}


/*
 * Lee una dimensión completa.
 */
function parseDimension(
  id,
  dimension
) {
  const category =
    dimension.category || {};

  const labels =
    (
      category.label &&
      typeof category.label === 'object'
    )
      ? category.label
      : {};

  let indexed =
    parseCategoryIndex(
      category
    );

  /*
   * Fallback para JSON-stat en el que
   * no venga category.index.
   */
  if (!indexed.length) {
    indexed =
      parseCategoriesWithoutIndex(
        category
      );
  }

  const categories =
    indexed.map(
      item => ({
        code:
          item.code,

        label:
          labels[item.code] !== undefined
            ? String(
                labels[item.code]
              )
            : item.code,

        index:
          item.index
      })
    );

  return {
    id,

    label:
      dimension.label ||
      id,

    categories,

    extension:
      dimension.extension ||
      {}
  };
}


/*
 * Lee las dimensiones respetando
 * EXACTAMENTE el orden de dataset.id.
 *
 * Esto es fundamental para interpretar
 * correctamente dataset.size + dataset.value.
 */
function parseDimensions(dataset) {
  let ids;

  if (
    Array.isArray(dataset.id)
  ) {
    ids =
      dataset.id.map(String);
  } else if (
    dataset.id &&
    typeof dataset.id === 'object'
  ) {
    ids =
      Object.keys(dataset.id);
  } else {
    ids =
      Object.keys(
        dataset.dimension || {}
      );
  }

  return ids.map(
    id => {
      const dimension =
        dataset.dimension?.[id];

      if (!dimension) {
        throw new Error(
          `No se encontró la dimensión "${id}" en la respuesta JSON-stat.`
        );
      }

      return parseDimension(
        id,
        dimension
      );
    }
  );
}


/*
 * Convierte un índice plano del array
 * value en las coordenadas de cada dimensión.
 *
 * JSON-stat utiliza la última dimensión
 * como la que cambia más rápidamente.
 *
 * Ejemplo:
 *
 * size = [2, 3]
 *
 * 0 -> [0,0]
 * 1 -> [0,1]
 * 2 -> [0,2]
 * 3 -> [1,0]
 * 4 -> [1,1]
 * 5 -> [1,2]
 */
function flatIndexToCoordinates(
  flatIndex,
  sizes
) {
  const coordinates =
    new Array(
      sizes.length
    );

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
 * JSON-stat puede representar "value" como:
 *
 * [
 *   100,
 *   104.5,
 *   107.8
 * ]
 *
 * o como objeto disperso:
 *
 * {
 *   "0": 100,
 *   "1": 104.5
 * }
 *
 * Esta función unifica ambos casos.
 */
function getValueAt(
  value,
  index
) {
  if (
    Array.isArray(value)
  ) {
    return (
      value[index] !== undefined
        ? value[index]
        : null
    );
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return (
      value[String(index)] !== undefined
        ? value[String(index)]
        : null
    );
  }

  return null;
}


/*
 * Parser JSON-stat 1.2.
 */
function parseJsonStat(response) {
  const dataset =
    getDataset(response);

  if (
    !dataset ||
    typeof dataset !== 'object'
  ) {
    throw new Error(
      'La respuesta de Eustat está vacía o no es un objeto JSON.'
    );
  }

  if (
    !dataset.dimension ||
    typeof dataset.dimension !== 'object'
  ) {
    throw new Error(
      'La respuesta JSON-stat no contiene "dataset.dimension".'
    );
  }

  if (
    !dataset.id
  ) {
    throw new Error(
      'La respuesta JSON-stat no contiene "dataset.id".'
    );
  }

  if (
    !Array.isArray(dataset.size)
  ) {
    throw new Error(
      'La respuesta JSON-stat no contiene un "dataset.size" válido.'
    );
  }

  const dimensions =
    parseDimensions(
      dataset
    );

  const sizes =
    dataset.size.map(
      Number
    );

  /*
   * Comprobamos que tenemos una dimensión
   * por cada tamaño.
   */
  if (
    dimensions.length !==
    sizes.length
  ) {
    throw new Error(
      `JSON-stat inconsistente: hay ${dimensions.length} dimensiones pero ${sizes.length} tamaños.`
    );
  }

  /*
   * Número total de celdas del cubo.
   */
  const totalCells =
    sizes.reduce(
      (total, size) =>
        total * size,
      1
    );

  if (
    !Number.isFinite(totalCells) ||
    totalCells < 0
  ) {
    throw new Error(
      'El tamaño del cubo JSON-stat no es válido.'
    );
  }

  const rows = [];

  /*
   * Recorremos todas las celdas.
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
      (
        dimension,
        dimensionIndex
      ) => {
        const position =
          coordinates[
            dimensionIndex
          ];

        const category =
          dimension.categories.find(
            item =>
              item.index === position
          );

        if (category) {
          valuesByDimension[
            dimension.id
          ] =
            category.label;

          codesByDimension[
            dimension.id
          ] =
            category.code;
        } else {
          /*
           * Esto no debería ocurrir
           * en una respuesta JSON-stat
           * correcta, pero evitamos que
           * la aplicación se rompa.
           */
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
        getValueAt(
          dataset.value,
          flatIndex
        ),

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
   CATÁLOGO — INTERFAZ
   ========================================================= */

function renderCatalog() {
  app.innerHTML = `
    <main class="catalog">

      <div class="catalog-inner">

        <div class="breadcrumbs">
          <span>Eustat Statbank</span>
        </div>

        <h1>
          Tablas estadísticas
        </h1>

        <p>
          Explora y consulta los datos
          estadísticos de Eustat.
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
              <strong>
                Tablas
              </strong>
            </div>

            <div>
              <span>
                Ordenadas por fecha
                de actualización
              </span>
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
    document.querySelector(
      '#search'
    );

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


function renderCatalogResults(
  term
) {
  const text =
    String(term || '')
      .trim()
      .toLocaleLowerCase('es');

  /*
   * Copiamos antes de ordenar para
   * no modificar el catálogo original.
   */
  let results =
    catalog.filter(
      item => {
        if (!text) {
          return true;
        }

        const searchable =
          [
            item.title,
            item.text,
            item.id,
            item.search_text,
            item.operacion_titulo,
            item.operacion,
            item.frequency
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('es');

        return searchable.includes(
          text
        );
      }
    );

  /*
   * Más nuevas primero.
   */
  results.sort(
    (a, b) =>
      catalogSortValue(b) -
      catalogSortValue(a)
  );

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

  if (!container) {
    return;
  }

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
      .map(
        item => `
          <article
            class="table-card">

            <h2>
              ${escapeHtml(
                item.title ||
                item.text ||
                item.id
              )}
            </h2>

            ${
              item.id
                ? `
                  <p class="table-id">
                    ${escapeHtml(
                      item.id
                    )}
                  </p>
                `
                : ''
            }

            ${
              item.updated
                ? `
                  <p>
                    Actualizada:
                    ${escapeHtml(
                      formatDate(
                        item.updated
                      )
                    )}
                  </p>
                `
                : ''
            }

            <a
              href="#/table/${encodeURIComponent(
                item.id
              )}"
              class="open-table">

              Abrir tabla →

            </a>

          </article>
        `
      )
      .join('');
}


/* =========================================================
   ABRIR TABLA
   ========================================================= */

async function openTable(id) {
  const table =
    catalog.find(
      item =>
        item.id === id
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
          Cargando metadatos de Eustat...
        </div>

      </div>

    </main>
  `;

  try {
    const metadata =
      await getMetadata(id);

    if (
      !metadata ||
      !Array.isArray(
        metadata.variables
      )
    ) {
      throw new Error(
        'Eustat no devolvió una lista de variables válida para esta tabla.'
      );
    }

    state.metadata =
      metadata;

    state.selections =
      initializeSelections(
        metadata
      );

    renderTablePage();

  } catch (error) {
    renderError(error);
  }
}


/* =========================================================
   PÁGINA DE TABLA
   ========================================================= */

function renderTablePage() {
  const metadata =
    state.metadata;

  const variables =
    Array.isArray(
      metadata.variables
    )
      ? metadata.variables
      : [];

  const title =
    metadata.title ||
    state.table.title ||
    state.table.id;

  app.innerHTML = `
    <main class="table-page">

      <div class="table-page-inner">

        <div class="breadcrumbs">

          <a href="#/">
            Tablas
          </a>

          <span>›</span>

          <span>
            ${escapeHtml(title)}
          </span>

        </div>

        <h1>
          ${escapeHtml(title)}
        </h1>

        ${
          state.table.updated
            ? `
              <p class="table-updated">
                Actualizada:
                ${escapeHtml(
                  formatDate(
                    state.table.updated
                  )
                )}
              </p>
            `
            : ''
        }

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

            <div id="status"></div>

            <div id="result">

              <div class="table-placeholder">

                Selecciona los valores que quieras
                consultar y pulsa
                <strong>
                  Mostrar tabla
                </strong>.

              </div>

            </div>

          </section>

        </div>

      </div>

    </main>
  `;

  attachVariableEvents();

  document
    .querySelector(
      '#show-data'
    )
    .addEventListener(
      'click',
      executeQuery
    );

  document
    .querySelector(
      '#download-csv'
    )
    .addEventListener(
      'click',
      downloadCSV
    );

  document
    .querySelector(
      '#copy-query'
    )
    .addEventListener(
      'click',
      copyQuery
    );
}


/* =========================================================
   RENDER VARIABLE
   ========================================================= */

function renderVariable(
  variable
) {
  const values =
    getDisplayValues(
      variable
    );

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
      data-variable="${escapeAttribute(
        variable.code
      )}">

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
          /
          ${values.length}

        </span>

      </div>

      <div class="variable-actions">

        <button
          type="button"
          data-select-all="${escapeAttribute(
            variable.code
          )}">

          Todos

        </button>

        <button
          type="button"
          data-select-none="${escapeAttribute(
            variable.code
          )}">

          Ninguno

        </button>

      </div>

      ${
        values.length > 8
          ? `
            <div class="variable-search">

              <input
                type="search"
                placeholder="Buscar..."
                data-variable-search="${escapeAttribute(
                  variable.code
                )}"
              >

            </div>
          `
          : ''
      }

      <div
        class="variable-values"
        data-values="${escapeAttribute(
          variable.code
        )}">

        ${
          values
            .map(
              item => `
                <label
                  class="value-option"
                  data-label="${escapeAttribute(
                    item.label
                      .toLocaleLowerCase(
                        'es'
                      )
                  )}">

                  <input
                    type="checkbox"

                    data-variable="${escapeAttribute(
                      variable.code
                    )}"

                    data-code="${escapeAttribute(
                      item.code
                    )}"

                    ${
                      selected.includes(
                        item.code
                      )
                        ? 'checked'
                        : ''
                    }
                  >

                  <span>
                    ${escapeHtml(
                      item.label
                    )}
                  </span>

                </label>
              `
            )
            .join('')
        }

      </div>

    </div>
  `;
}


/* =========================================================
   EVENTOS DE VARIABLES
   ========================================================= */

function attachVariableEvents() {

  /*
   * CHECKBOXES
   */
  document
    .querySelectorAll(
      '.value-option input[type="checkbox"]'
    )
    .forEach(
      input => {
        input.addEventListener(
          'change',
          () => {

            const variable =
              input.dataset.variable;

            const code =
              input.dataset.code;

            let selected =
              [
                ...getSelected(
                  variable
                )
              ];

            if (
              input.checked
            ) {
              if (
                !selected.includes(
                  code
                )
              ) {
                selected.push(
                  code
                );
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
      }
    );


  /*
   * TODOS
   */
  document
    .querySelectorAll(
      '[data-select-all]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            const code =
              button.dataset.selectAll;

            const variable =
              state.metadata.variables.find(
                item =>
                  item.code ===
                  code
              );

            if (!variable) {
              return;
            }

            const values =
              getVariableValues(
                variable
              );

            setSelected(
              code,
              values.map(
                item =>
                  item.code
              )
            );

            refreshVariable(
              code
            );
          }
        );
      }
    );


  /*
   * NINGUNO
   */
  document
    .querySelectorAll(
      '[data-select-none]'
    )
    .forEach(
      button => {

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
      }
    );


  /*
   * BUSCAR
   */
  document
    .querySelectorAll(
      '[data-variable-search]'
    )
    .forEach(
      input => {

        input.addEventListener(
          'input',
          () => {

            const code =
              input.dataset.variableSearch;

            const term =
              input.value
                .trim()
                .toLocaleLowerCase(
                  'es'
                );

            const selector =
              `[data-values="${CSS.escape(
                code
              )}"] .value-option`;

            document
              .querySelectorAll(
                selector
              )
              .forEach(
                option => {

                  const label =
                    option.dataset.label ||
                    '';

                  option.style.display =
                    !term ||
                    label.includes(
                      term
                    )
                      ? ''
                      : 'none';
                }
              );
          }
        );
      }
    );
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
        item.code ===
        variableCode
    );

  if (!variable) {
    return;
  }

  const id =
    `count-${encodeURIComponent(
      variableCode
    )}`;

  const element =
    document.getElementById(id);

  if (!element) {
    return;
  }

  element.textContent =
    `${getSelected(variableCode).length} / ${getVariableValues(variable).length}`;
}


function refreshVariable(
  variableCode
) {
  const selected =
    getSelected(
      variableCode
    );

  document
    .querySelectorAll(
      `input[data-variable="${CSS.escape(
        variableCode
      )}"]`
    )
    .forEach(
      input => {

        input.checked =
          selected.includes(
            input.dataset.code
          );
      }
    );

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
   * Todas las dimensiones deben tener
   * al menos una categoría seleccionada.
   */
  const empty =
    state.metadata.variables.filter(
      variable =>
        getSelected(
          variable.code
        ).length === 0
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
                  `
                    <li>
                      ${escapeHtml(
                        variable.text ||
                        variable.code
                      )}
                    </li>
                  `
              )
              .join('')
          }

        </ul>

      </div>
    `;

    return;
  }

  button.disabled =
    true;

  csvButton.disabled =
    true;

  status.innerHTML =
    '';

  result.innerHTML = `
    <div class="loading">
      Consultando Eustat...
    </div>
  `;

  const query =
    buildQuery();

  try {

    const response =
      await postQuery(
        state.table.id,
        query
      );

    /*
     * IMPORTANTE:
     *
     * Aquí recibimos directamente
     * el JSON-stat de Eustat y lo
     * reconstruimos utilizando:
     *
     * dataset.id
     * dataset.size
     * dataset.dimension
     * dataset.value
     */
    const parsed =
      parseJsonStat(
        response
      );

    state.result =
      parsed;

    renderResult(
      parsed
    );

    csvButton.disabled =
      false;

    status.innerHTML = `
      <div class="api-ok">

        Datos obtenidos directamente
        de la API de Eustat.

        <strong>
          ${parsed.rows.length.toLocaleString(
            'es-ES'
          )}
        </strong>

        observaciones.

      </div>
    `;

  } catch (error) {

    state.result =
      null;

    result.innerHTML = `
      <div class="api-error">

        <strong>
          Error al consultar Eustat
        </strong>

        <p>
          ${escapeHtml(
            error.message
          )}
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
                  format:
                    'json-stat'
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

    button.disabled =
      false;
  }
}


/* =========================================================
   RENDER RESULTADO
   ========================================================= */

function renderResult(
  parsed
) {
  const result =
    document.querySelector(
      '#result'
    );

  if (
    !parsed.rows.length
  ) {
    result.innerHTML = `
      <div class="table-placeholder">
        La consulta no ha devuelto datos.
      </div>
    `;

    return;
  }

  const headers =
    parsed.dimensions
      .map(
        dimension =>
          `
            <th>
              ${escapeHtml(
                dimension.label
              )}
            </th>
          `
      )
      .join('');

  const body =
    parsed.rows
      .map(
        row => {

          const cells =
            parsed.dimensions
              .map(
                dimension =>
                  `
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
        }
      )
      .join('');

  result.innerHTML = `
    <div class="result-info">

      <strong>
        ${parsed.rows.length.toLocaleString(
          'es-ES'
        )}
      </strong>

      observaciones

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
   COPIAR CONSULTA API
   ========================================================= */

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


function showStatus(
  message
) {
  const status =
    document.querySelector(
      '#status'
    );

  if (!status) {
    return;
  }

  status.innerHTML = `
    <div class="api-ok">
      ${escapeHtml(message)}
    </div>
  `;

  setTimeout(
    () => {
      status.innerHTML =
        '';
    },
    2500
  );
}


/* =========================================================
   CSV
   ========================================================= */

function csvEscape(
  value
) {
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
   * BOM UTF-8 para que Excel
   * reconozca correctamente
   * caracteres como á, ñ, etc.
   */
  return (
    '\uFEFF' +
    lines.join('\r\n')
  );
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

function renderError(
  error
) {
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
    location.hash ||
    '#/';

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
  .then(
    () => {
      route();
    }
  )
  .catch(
    error => {
      renderError(
        error
      );
    }
  );

window.addEventListener(
  'hashchange',
  route
);
