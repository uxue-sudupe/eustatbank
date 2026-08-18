const API_BASE =
  'https://www.eustat.eus/bankupx/api/v1/es/DB';

const CATALOG_URL =
  './data/index_es.json';

const app =
  document.querySelector('#app');

let catalog = [];

const state = {
  table: null,
  metadata: null,
  selections: {},
  result: null
};


/* =========================================================
   UTILIDADES
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
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('es-ES');
}


/*
 * Ordenación de periodos.
 *
 * Solo afecta a la interfaz.
 * Nunca modifica los códigos enviados a Eustat.
 *
 * Ejemplos:
 *
 * 2025
 * 2024
 * 2023
 *
 * 2025-12
 * 2025-11
 *
 * 2025-4
 * 2025-3
 *
 * 2025-01
 */

function periodSortValue(value) {
  const text = String(value);

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

  const period =
    numberMatch
      ? Number(numberMatch[1])
      : 0;

  return year * 1000 + period;
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

async function loadCatalog() {
  const response =
    await fetch(CATALOG_URL);

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar el catálogo (${response.status}).`
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

async function getMetadata(tableId) {
  const url =
    `${API_BASE}/${encodeURIComponent(tableId)}`;

  const response =
    await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `No se pudieron obtener los metadatos (${response.status}).`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Eustat no devolvió metadatos JSON válidos.'
    );
  }
}


async function postQuery(tableId, query) {
  const url =
    `${API_BASE}/${encodeURIComponent(tableId)}`;

  const body = {
    query,
    response: {
      format: 'json-stat'
    }
  };

  const response =
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    });

  const text =
    await response.text();

  /*
   * Muy importante:
   *
   * No intentamos interpretar la respuesta antes
   * de comprobar el HTTP.
   *
   * Esto permite distinguir:
   *
   * 400 de Eustat
   * respuesta JSON válida
   * JSON-stat incorrecto
   * etc.
   */

  if (!response.ok) {
    let message = text;

    try {
      const errorJson =
        JSON.parse(text);

      message =
        errorJson.message ||
        errorJson.error ||
        errorJson.title ||
        text;
    } catch {
      // La respuesta no era JSON.
    }

    throw new Error(
      `Eustat respondió HTTP ${response.status}: ${message}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Eustat respondió correctamente, pero no devolvió JSON válido:\n${text.slice(0, 1000)}`
    );
  }
}


/* =========================================================
   METADATOS
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

      originalIndex: index
    })
  );
}


function getDisplayValues(variable) {
  const values =
    getVariableValues(variable);

  /*
   * Solo ordenamos de forma descendente
   * las variables que Eustat marca como time.
   */

  if (!variable.time) {
    return values;
  }

  return [...values].sort(
    (a, b) => {
      const aValue =
        periodSortValue(a.code);

      const bValue =
        periodSortValue(b.code);

      if (
        aValue === null ||
        bValue === null
      ) {
        return (
          a.originalIndex -
          b.originalIndex
        );
      }

      return bValue - aValue;
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
      getVariableValues(variable);

    /*
     * Seleccionamos el primer código REAL
     * del metadato, no el primer elemento
     * de la lista visual.
     *
     * Esto es importante porque los periodos
     * se muestran ordenados al revés.
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
    [...new Set(values.map(String))];
}


/* =========================================================
   QUERY
   ========================================================= */

function buildQuery() {
  return (
    state.metadata.variables || []
  )
    .map(variable => {
      const values =
        getSelected(variable.code);

      return {
        code: variable.code,

        selection: {
          filter: 'item',
          values
        }
      };
    });
}


function getQueryObject() {
  return {
    query: buildQuery(),

    response: {
      format: 'json-stat'
    }
  };
}


/* =========================================================
   JSON-STAT
   ========================================================= */

function getDataset(response) {
  /*
   * Eustat utiliza:
   *
   * {
   *   "dataset": {
   *      ...
   *   }
   * }
   *
   * Pero aceptamos también un dataset directo.
   */

  if (
    response &&
    response.dataset &&
    typeof response.dataset === 'object'
  ) {
    return response.dataset;
  }

  return response;
}


/*
 * category.index puede venir como:
 *
 * {
 *   "100": 0,
 *   "200": 1
 * }
 *
 * o como array.
 */

function parseCategoryIndex(category) {
  if (
    !category ||
    category.index === undefined
  ) {
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

  if (
    typeof index === 'object' &&
    index !== null
  ) {
    return Object.entries(index)
      .map(
        ([code, position]) => ({
          code: String(code),
          index: Number(position)
        })
      )
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
 * Algunas implementaciones de JSON-stat
 * pueden devolver las etiquetas como arrays.
 *
 * Por eso no asumimos que siempre son
 * simples strings.
 */

function getCategoryLabel(
  labels,
  code,
  index
) {
  if (!labels) {
    return code;
  }

  if (
    Array.isArray(labels) &&
    labels[index] !== undefined
  ) {
    return String(labels[index]);
  }

  if (
    typeof labels === 'object' &&
    labels[code] !== undefined
  ) {
    const value =
      labels[code];

    if (
      Array.isArray(value)
    ) {
      return String(
        value[0] ?? code
      );
    }

    return String(value);
  }

  return code;
}


function parseDimension(
  id,
  dimension
) {
  const category =
    dimension.category || {};

  const indexed =
    parseCategoryIndex(category);

  const labels =
    category.label;

  const categories =
    indexed.map(item => ({
      code: item.code,

      label:
        getCategoryLabel(
          labels,
          item.code,
          item.index
        ),

      index: item.index
    }));

  return {
    id,

    label:
      dimension.label ||
      id,

    categories,

    extension:
      dimension.extension || {}
  };
}


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
        `JSON-stat: no existe la dimensión "${id}".`
      );
    }

    return parseDimension(
      id,
      dimension
    );
  });
}


/*
 * JSON-stat utiliza un array plano.
 *
 * size = [2, 3]
 *
 * significa:
 *
 * dimensión 1 = 2 categorías
 * dimensión 2 = 3 categorías
 *
 * La última dimensión cambia más rápido.
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
 * Obtiene un valor del array JSON-stat.
 *
 * Normalmente value es un array.
 *
 * También toleramos:
 *
 * - null
 * - valores ausentes
 * - objetos indexados
 */

function getValue(
  values,
  flatIndex
) {
  if (
    Array.isArray(values)
  ) {
    return (
      values[flatIndex] ??
      null
    );
  }

  if (
    values &&
    typeof values === 'object'
  ) {
    return (
      values[flatIndex] ??
      null
    );
  }

  return null;
}


function parseJsonStat(response) {
  const dataset =
    getDataset(response);

  if (!dataset) {
    throw new Error(
      'La respuesta JSON-stat está vacía.'
    );
  }

  /*
   * Eustat debería devolver:
   *
   * id
   * size
   * dimension
   * value
   */

  if (
    !Array.isArray(dataset.id) ||
    !Array.isArray(dataset.size) ||
    !dataset.dimension
  ) {
    throw new Error(
      'La respuesta no contiene una estructura JSON-stat reconocible.'
    );
  }

  const dimensions =
    parseDimensions(dataset);

  const sizes =
    dataset.size.map(Number);

  const totalCells =
    sizes.reduce(
      (total, size) =>
        total * size,
      1
    );

  const rows = [];

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

        valuesByDimension[
          dimension.id
        ] =
          category
            ? category.label
            : '';

        codesByDimension[
          dimension.id
        ] =
          category
            ? category.code
            : '';
      }
    );

    rows.push({
      values:
        valuesByDimension,

      codes:
        codesByDimension,

      value:
        getValue(
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
   CATÁLOGO - INTERFAZ
   ========================================================= */

function renderCatalog() {
  app.innerHTML = `
    <main class="catalog-page">

      <div class="catalog-inner">

        <div class="catalog-intro">
          <h1>Eustat Statbank</h1>

          <p>
            Explora las tablas estadísticas de Eustat
            con una experiencia inspirada en PxWeb.
          </p>
        </div>

        <div class="catalog-search">
          <input
            id="catalog-search"
            type="search"
            placeholder="Buscar por título, operación, variable o palabra clave..."
            autocomplete="off"
          >
        </div>

        <div class="catalog-layout">

          <aside class="catalog-sidebar">

            <div class="catalog-filter">
              <strong>Contenido</strong>
            </div>

            <div class="catalog-filter">
              <strong>Operación estadística</strong>
            </div>

            <div class="catalog-filter">
              <strong>Frecuencia</strong>
            </div>

            <div class="catalog-filter">
              <strong>Periodo</strong>
            </div>

          </aside>

          <section>

            <div
              id="catalog-count"
              class="catalog-count">
            </div>

            <div
              id="catalog-results"
              class="catalog-results">
            </div>

          </section>

        </div>

      </div>

    </main>
  `;

  const search =
    document.querySelector(
      '#catalog-search'
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

  const results =
    catalog.filter(item => {
      if (!text) return true;

      const searchable = [
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
      <div class="empty-state">
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
            ${escapeHtml(
              item.id || ''
            )}
          </p>

          ${
            item.updated
              ? `
                <p class="table-date">
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
            class="table-open"
            href="#/table/${encodeURIComponent(item.id)}">

            Abrir tabla →

          </a>

        </article>
      `)
      .join('');
}


/* =========================================================
   ABRIR TABLA
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

  state.table = table;
  state.metadata = null;
  state.selections = {};
  state.result = null;

  app.innerHTML = `
    <main class="loading-page">
      <div class="loading-card">
        Cargando metadatos de Eustat…
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
        'Eustat no devolvió metadatos de tabla reconocibles.'
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
    metadata.variables || [];

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

        <div class="table-header">

          <h1>
            ${escapeHtml(
              metadata.title ||
              state.table.title ||
              state.table.id
            )}
          </h1>

          <p class="table-api-note">
            ⓘ Consulta datos directamente desde
            la API pública de Eustat.
          </p>

        </div>

        <div class="table-layout">

          <aside class="filter-pane">

            <div class="filter-pane-header">

              <h2>
                Seleccionar datos
              </h2>

            </div>

            <div id="filters">

              ${variables
                .map(renderVariable)
                .join('')}

            </div>

          </aside>

          <section class="results-pane">

            <div class="toolbar">

              <button
                id="show-data"
                class="button button-primary">
                Mostrar tabla
              </button>

              <button
                id="download-csv"
                class="button button-secondary"
                disabled>
                Descargar CSV
              </button>

              <button
                id="copy-query"
                class="button button-secondary">
                Copiar consulta API
              </button>

            </div>

            <div id="status"></div>

            <div id="result">

              <div class="result-placeholder">
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
   FILTROS
   ========================================================= */

function renderVariable(variable) {
  const values =
    getDisplayValues(variable);

  const selected =
    getSelected(
      variable.code
    );

  const id =
    encodeURIComponent(
      variable.code
    );

  return `
    <section
      class="filter-card"
      data-variable="${escapeHtml(
        variable.code
      )}">

      <div class="filter-card-header">

        <div>
          <h3>
            ${escapeHtml(
              variable.text ||
              variable.code
            )}
          </h3>

          <span class="selection-badge">
            ${selected.length}
            de
            ${values.length}
            seleccionados
          </span>
        </div>

      </div>

      <div class="filter-actions">

        <button
          type="button"
          data-select-all="${escapeHtml(
            variable.code
          )}">
          Todos
        </button>

        <button
          type="button"
          data-select-none="${escapeHtml(
            variable.code
          )}">
          Ninguno
        </button>

      </div>

      ${
        values.length > 12
          ? `
            <div class="filter-search">

              <input
                type="search"
                placeholder="Buscar..."
                data-variable-search="${escapeHtml(
                  variable.code
                )}">

            </div>
          `
          : ''
      }

      <div
        class="value-list"
        data-values="${escapeHtml(
          variable.code
        )}">

        ${
          values
            .map(item => `
              <label
                class="value-option"
                data-label="${escapeHtml(
                  item.label
                    .toLocaleLowerCase(
                      'es'
                    )
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
            `)
            .join('')
        }

      </div>

    </section>
  `;
}


/* =========================================================
   EVENTOS DE FILTROS
   ========================================================= */

function attachVariableEvents() {
  document
    .querySelectorAll(
      '.value-option input'
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
            if (
              !selected.includes(code)
            ) {
              selected.push(code);
            }
          } else {
            selected =
              selected.filter(
                item =>
                  item !== code
              );
          }

          setSelected(
            variable,
            selected
          );

          updateFilterCard(
            variable
          );
        }
      );
    });


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
            getVariableValues(
              variable
            );

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
              .toLocaleLowerCase(
                'es'
              );

          const container =
            document.querySelector(
              `[data-values="${CSS.escape(
                code
              )}"]`
            );

          if (!container) return;

          container
            .querySelectorAll(
              '.value-option'
            )
            .forEach(option => {

              const label =
                option.dataset.label ||
                '';

              option.hidden =
                !!term &&
                !label.includes(
                  term
                );
            });
        }
      );
    });
}


/* =========================================================
   ACTUALIZAR FILTRO
   ========================================================= */

function updateFilterCard(
  variableCode
) {
  const variable =
    state.metadata.variables.find(
      item =>
        item.code === variableCode
    );

  if (!variable) return;

  const card =
    document.querySelector(
      `.filter-card[data-variable="${CSS.escape(
        variableCode
      )}"]`
    );

  if (!card) return;

  const badge =
    card.querySelector(
      '.selection-badge'
    );

  if (badge) {
    badge.textContent =
      `${getSelected(variableCode).length} de ${
        getVariableValues(variable).length
      } seleccionados`;
  }
}


function refreshVariable(
  variableCode
) {
  const selected =
    getSelected(variableCode);

  document
    .querySelectorAll(
      `input[data-variable="${CSS.escape(
        variableCode
      )}"]`
    )
    .forEach(input => {
      input.checked =
        selected.includes(
          input.dataset.code
        );
    });

  updateFilterCard(
    variableCode
  );
}


/* =========================================================
   CONSULTA
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

  const empty =
    state.metadata.variables
      .filter(
        variable =>
          getSelected(
            variable.code
          ).length === 0
      );

  if (empty.length) {
    result.innerHTML = `
      <div class="message message-error">

        <strong>
          Faltan selecciones
        </strong>

        <p>
          Selecciona al menos un valor en:
        </p>

        <ul>
          ${empty
            .map(
              variable =>
                `<li>${escapeHtml(
                  variable.text ||
                  variable.code
                )}</li>`
            )
            .join('')}
        </ul>

      </div>
    `;

    return;
  }

  button.disabled = true;
  csvButton.disabled = true;

  status.innerHTML = '';

  result.innerHTML = `
    <div class="loading-card">
      Consultando Eustat…
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

    const parsed =
      parseJsonStat(response);

    state.result =
      parsed;

    renderResult(parsed);

    csvButton.disabled = false;

    status.innerHTML = `
      <div class="message message-success">

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
    state.result = null;

    result.innerHTML = `
      <div class="message message-error">

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
              getQueryObject(),
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
   RESULTADO
   ========================================================= */

function renderResult(parsed) {
  const result =
    document.querySelector(
      '#result'
    );

  if (!parsed.rows.length) {
    result.innerHTML = `
      <div class="result-placeholder">
        La consulta no ha devuelto datos.
      </div>
    `;

    return;
  }

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

            <td class="numeric-cell">
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
    <div class="result-summary">

      <strong>
        ${parsed.rows.length.toLocaleString(
          'es-ES'
        )}
      </strong>

      observaciones

    </div>

    <div class="result-table-wrap">

      <table class="result-table">

        <thead>
          <tr>
            ${headers}
            <th>Valor</th>
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
   COPIAR CONSULTA
   ========================================================= */

async function copyQuery() {
  const text =
    JSON.stringify(
      getQueryObject(),
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
    <div class="message message-success">
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

  const lines = [];

  lines.push(
    [
      ...dimensions.map(
        dimension =>
          dimension.label
      ),
      'Valor'
    ]
      .map(csvEscape)
      .join(';')
  );

  for (
    const row
    of state.result.rows
  ) {
    lines.push(
      [
        ...dimensions.map(
          dimension =>
            row.values[
              dimension.id
            ]
        ),
        row.value
      ]
        .map(csvEscape)
        .join(';')
    );
  }

  return (
    '\uFEFF' +
    lines.join('\r\n')
  );
}


function downloadCSV() {
  if (!state.result) return;

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
    <main class="error-page">

      <div class="error-card">

        <h1>
          Se ha producido un error
        </h1>

        <p>
          ${escapeHtml(
            error.message
          )}
        </p>

        <a href="#/">
          ← Volver al catálogo
        </a>

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
  .then(route)
  .catch(renderError);

window.addEventListener(
  'hashchange',
  route
);
