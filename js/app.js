const API = 'https://www.eustat.eus/bankupx/api/v1/es/DB';
const DATA = './data/index_es.json';

const app = document.querySelector('#app');

let catalog = [];

let state = {
  meta: null,
  selections: {},
  result: null,
  table: null
};


/* =========================================================
   UTILIDADES
   ========================================================= */

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}


function fmtDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}


function formatNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number') {
    return value.toLocaleString('es-ES', {
      maximumFractionDigits: 15
    });
  }

  return String(value);
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

async function loadCatalog() {
  const response = await fetch(DATA);

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar el catálogo (${response.status})`
    );
  }

  const json = await response.json();

  catalog = json.data || [];

  if (!Array.isArray(catalog)) {
    catalog = [];
  }
}


/* =========================================================
   API EUSTAT
   ========================================================= */

async function apiMeta(id) {
  const response = await fetch(
    `${API}/${encodeURIComponent(id)}`,
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


async function apiData(id, query) {
  const response = await fetch(
    `${API}/${encodeURIComponent(id)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        ...query,
        response: {
          format: 'json-stat'
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');

    throw new Error(
      `La consulta ha fallado (${response.status})` +
      (text ? `: ${text.slice(0, 500)}` : '')
    );
  }

  return response.json();
}


/* =========================================================
   JSON-STAT 1.2
   ========================================================= */

/*
 * Eustat devuelve JSON-stat 1.2.
 *
 * Dependiendo del endpoint/respuesta, podemos encontrarnos:
 *
 * {
 *   "id": [...],
 *   "size": [...],
 *   "dimension": {...},
 *   "value": [...]
 * }
 *
 * o una respuesta envuelta:
 *
 * {
 *   "dataset": {
 *      "id": [...],
 *      "size": [...],
 *      "dimension": {...},
 *      "value": [...]
 *   }
 *
 * Esta función acepta las dos.
 */
function getJsonStatDataset(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(
      'La respuesta de la API no es un objeto JSON válido.'
    );
  }

  if (
    payload.dataset &&
    typeof payload.dataset === 'object'
  ) {
    return payload.dataset;
  }

  return payload;
}


/*
 * Convierte category.index a:
 *
 * [
 *   { code: 'A', index: 0 },
 *   { code: 'B', index: 1 },
 *   ...
 * ]
 *
 * JSON-stat normalmente utiliza un objeto:
 *
 * {
 *   "_T": 0,
 *   "01": 1,
 *   "48": 2
 * }
 *
 * Pero también soportamos arrays y algunas variantes.
 */
function readCategoryIndex(category) {
  const index = category?.index;

  if (!index) {
    return [];
  }

  if (Array.isArray(index)) {
    return index.map((code, position) => ({
      code: String(code),
      index: position
    }));
  }

  if (typeof index === 'object') {
    return Object.entries(index)
      .map(([code, position]) => ({
        code: String(code),
        index: Number(position)
      }))
      .filter(item => Number.isFinite(item.index))
      .sort((a, b) => a.index - b.index);
  }

  return [];
}


/*
 * Obtiene las categorías de una dimensión.
 *
 * IMPORTANTE:
 *
 * El código NO se interpreta.
 *
 * Por ejemplo:
 *
 * _T → puede ser "C.A. de Euskadi"
 * _T → puede ser "Total"
 *
 * 200 → puede ser cualquier categoría.
 *
 * La etiqueta siempre viene de category.label.
 */
function readDimensionCategories(dimension) {
  const category = dimension?.category || {};

  const indexed = readCategoryIndex(category);

  const labels =
    category.label &&
    typeof category.label === 'object'
      ? category.label
      : {};

  /*
   * Si category.index existe, usamos exactamente
   * el orden indicado por JSON-stat.
   */
  if (indexed.length) {
    return indexed.map(item => ({
      code: item.code,
      label:
        labels[item.code] !== undefined
          ? labels[item.code]
          : item.code,
      index: item.index
    }));
  }


  /*
   * Algunas respuestas pueden tener label pero no index.
   * En ese caso usamos el orden de las claves.
   */
  const labelEntries = Object.entries(labels);

  return labelEntries.map(([code, label], index) => ({
    code,
    label,
    index
  }));
}


/*
 * Lee todas las dimensiones de JSON-stat.
 */
function readJsonStatDimensions(dataset) {
  if (!dataset.dimension) {
    throw new Error(
      'La respuesta JSON-stat no contiene "dimension".'
    );
  }

  const ids = Array.isArray(dataset.id)
    ? dataset.id.map(String)
    : Object.keys(dataset.dimension);

  return ids.map((id, dimensionIndex) => {
    const dimension = dataset.dimension[id];

    if (!dimension) {
      throw new Error(
        `No se encontró la dimensión "${id}".`
      );
    }

    const categories =
      readDimensionCategories(dimension);

    return {
      id,
      label: dimension.label || id,
      categories,
      size:
        Array.isArray(dataset.size)
          ? Number(dataset.size[dimensionIndex])
          : categories.length
    };
  });
}


/*
 * Convierte un índice plano de JSON-stat
 * a las coordenadas de cada dimensión.
 *
 * Ejemplo:
 *
 * size = [2, 3, 4]
 *
 * value[0]
 * value[1]
 * ...
 *
 * La última dimensión cambia más rápidamente.
 */
function flatIndexToCoordinates(flatIndex, sizes) {
  const coordinates = new Array(sizes.length);

  let remainder = flatIndex;

  for (let i = sizes.length - 1; i >= 0; i--) {
    const size = Number(sizes[i]);

    if (!size || size < 1) {
      coordinates[i] = 0;
      continue;
    }

    coordinates[i] = remainder % size;
    remainder = Math.floor(remainder / size);
  }

  return coordinates;
}


/*
 * Obtiene el valor de una categoría para una posición.
 */
function categoryAt(dimension, position) {
  const category = dimension.categories.find(
    item => item.index === position
  );

  if (category) {
    return category;
  }

  /*
   * Fallback si el índice no está disponible.
   */
  return dimension.categories[position] || {
    code: '',
    label: '',
    index: position
  };
}


/*
 * PARSER PRINCIPAL JSON-STAT 1.2
 *
 * Devuelve:
 *
 * {
 *   dimensions: [...],
 *   rows: [...]
 * }
 *
 * Cada row contiene:
 *
 * {
 *   values: {
 *      "Territorio": "C.A. de Euskadi",
 *      "Sexo": "Mujer",
 *      ...
 *   },
 *   codes: {
 *      ...
 *   },
 *   value: 123
 * }
 */
function parseJsonStat12(payload) {
  const dataset = getJsonStatDataset(payload);

  if (!dataset) {
    throw new Error(
      'No se encontró el dataset JSON-stat.'
    );
  }

  if (
    !dataset.dimension ||
    !dataset.id ||
    !dataset.size
  ) {
    throw new Error(
      'La respuesta no contiene una estructura JSON-stat 1.2 reconocible.'
    );
  }

  if (!Array.isArray(dataset.id)) {
    throw new Error(
      'JSON-stat: "id" no tiene el formato esperado.'
    );
  }

  if (!Array.isArray(dataset.size)) {
    throw new Error(
      'JSON-stat: "size" no tiene el formato esperado.'
    );
  }

  const dimensions =
    readJsonStatDimensions(dataset);

  const values = Array.isArray(dataset.value)
    ? dataset.value
    : [];

  const expectedLength =
    dataset.size.reduce(
      (total, size) => total * Number(size),
      1
    );

  /*
   * JSON-stat puede devolver menos valores explícitos
   * si existen observaciones omitidas/null.
   *
   * Pero si la diferencia es enorme, avisamos.
   */
  if (
    expectedLength > 0 &&
    values.length > expectedLength
  ) {
    throw new Error(
      `JSON-stat: hay ${values.length} valores para ` +
      `un espacio esperado de ${expectedLength}.`
    );
  }

  const rows = [];

  /*
   * Recorremos TODAS las posiciones de la matriz.
   */
  for (
    let flatIndex = 0;
    flatIndex < expectedLength;
    flatIndex++
  ) {
    const coordinates =
      flatIndexToCoordinates(
        flatIndex,
        dataset.size
      );

    const rowValues = {};
    const rowCodes = {};
    const rowCategories = {};

    dimensions.forEach((dimension, dimensionIndex) => {
      const position =
        coordinates[dimensionIndex];

      const category =
        categoryAt(dimension, position);

      rowValues[dimension.id] =
        category.label;

      rowCodes[dimension.id] =
        category.code;

      rowCategories[dimension.id] =
        category;
    });

    rows.push({
      values: rowValues,
      codes: rowCodes,
      categories: rowCategories,
      value:
        values[flatIndex] === undefined
          ? null
          : values[flatIndex],
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
   CONSTRUIR QUERY
   ========================================================= */

function getVariableValues(variable) {
  const values = Array.isArray(variable.values)
    ? variable.values
    : [];

  const texts =
    Array.isArray(variable.valueTexts)
      ? variable.valueTexts
      : [];

  return values.map((code, index) => ({
    code: String(code),
    label:
      texts[index] !== undefined
        ? texts[index]
        : String(code)
  }));
}


/*
 * Inicializa la selección de cada variable.
 *
 * Por defecto seleccionamos el primer valor.
 *
 * El usuario puede después pulsar "Todos".
 */
function initializeSelections(meta) {
  const selections = {};

  for (const variable of meta.variables || []) {
    const values =
      getVariableValues(variable);

    selections[variable.code] =
      values.length
        ? [values[0].code]
        : [];
  }

  return selections;
}


/*
 * Construye exactamente el objeto que espera
 * la API de Eustat.
 */
function buildQuery() {
  const query = [];

  for (const variable of state.meta.variables || []) {
    const selected =
      state.selections[variable.code] || [];

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

  return {
    query
  };
}


/* =========================================================
   SELECTORES DE VARIABLES
   ========================================================= */

function selectionCount(variable) {
  const selected =
    state.selections[variable.code] || [];

  const total =
    getVariableValues(variable).length;

  return `${selected.length} de ${total} seleccionados`;
}


function renderVariable(variable) {
  const values =
    getVariableValues(variable);

  const selected =
    state.selections[variable.code] || [];

  const variableId =
    `var-${encodeURIComponent(variable.code)}`;

  return `
    <div class="variable-card">

      <div class="variable-header">
        <strong>${esc(variable.text || variable.code)}</strong>

        <span class="selection-count"
              id="${variableId}-count">
          ${esc(selectionCount(variable))}
        </span>
      </div>

      <div class="variable-actions">

        <button
          type="button"
          class="small-button"
          data-action="select-all"
          data-variable="${esc(variable.code)}">
          Todos
        </button>

        <button
          type="button"
          class="small-button"
          data-action="select-none"
          data-variable="${esc(variable.code)}">
          Ninguno
        </button>

      </div>

      <div class="variable-values">

        ${
          values.map(item => `
            <label class="value-option">

              <input
                type="checkbox"
                data-variable="${esc(variable.code)}"
                data-value="${esc(item.code)}"
                ${selected.includes(item.code) ? 'checked' : ''}
              >

              <span>
                ${esc(item.label)}
              </span>

            </label>
          `).join('')
        }

      </div>

    </div>
  `;
}


/* =========================================================
   PÁGINA DE TABLA
   ========================================================= */

function renderTablePage() {
  const table = state.table;
  const meta = state.meta;

  app.innerHTML = `
    <main class="table-page">

      <div class="table-page-inner">

        <div class="breadcrumbs">
          <a href="#/">Tablas</a>
          <span>›</span>
          <span>${esc(meta.title || table.title || table.text)}</span>
        </div>

        <a class="back-link" href="#/">
          ← Volver a tablas
        </a>

        <h1>
          ${esc(meta.title || table.title || table.text)}
        </h1>

        <p class="updated">
          ${
            table.updated
              ? `Actualizada: ${esc(fmtDate(table.updated))}`
              : ''
          }
        </p>

        <div class="table-layout">

          <aside class="table-sidebar">

            <h2>Filtro</h2>

            <div id="variables">

              ${
                (meta.variables || [])
                  .map(renderVariable)
                  .join('')
              }

            </div>

          </aside>

          <section class="table-content">

            <div class="table-actions">

              <button
                type="button"
                id="show-table"
                class="primary-button">
                Mostrar tabla
              </button>

              <button
                type="button"
                id="download-csv"
                class="outline-button"
                disabled>
                CSV
              </button>

              <button
                type="button"
                id="download-excel"
                class="outline-button"
                disabled>
                Excel
              </button>

              <button
                type="button"
                id="copy-api"
                class="outline-button">
                Copiar consulta API
              </button>

            </div>

            <div id="api-status"></div>

            <div id="table-result">
              <div class="table-placeholder">
                Selecciona las variables y pulsa
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
    .querySelector('#show-table')
    .addEventListener(
      'click',
      loadTableData
    );

  document
    .querySelector('#copy-api')
    .addEventListener(
      'click',
      copyApiQuery
    );

  document
    .querySelector('#download-csv')
    .addEventListener(
      'click',
      downloadCsv
    );

  document
    .querySelector('#download-excel')
    .addEventListener(
      'click',
      downloadExcel
    );
}


/* =========================================================
   EVENTOS DE VARIABLES
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

          const value =
            input.dataset.value;

          if (!state.selections[variable]) {
            state.selections[variable] = [];
          }

          if (input.checked) {

            if (
              !state.selections[variable]
                .includes(value)
            ) {
              state.selections[variable]
                .push(value);
            }

          } else {

            state.selections[variable] =
              state.selections[variable]
                .filter(item => item !== value);

          }

          updateSelectionCount(variable);
        }
      );

    });


  document
    .querySelectorAll(
      '[data-action="select-all"]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const variableCode =
            button.dataset.variable;

          const variable =
            state.meta.variables.find(
              item => item.code === variableCode
            );

          if (!variable) return;

          state.selections[variableCode] =
            getVariableValues(variable)
              .map(item => item.code);

          refreshVariable(variableCode);
        }
      );

    });


  document
    .querySelectorAll(
      '[data-action="select-none"]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const variableCode =
            button.dataset.variable;

          state.selections[variableCode] = [];

          refreshVariable(variableCode);
        }
      );

    });
}


function updateSelectionCount(variableCode) {
  const variable =
    state.meta.variables.find(
      item => item.code === variableCode
    );

  if (!variable) return;

  const id =
    `var-${encodeURIComponent(variableCode)}-count`;

  const element =
    document.getElementById(id);

  if (element) {
    element.textContent =
      selectionCount(variable);
  }
}


function refreshVariable(variableCode) {
  const variable =
    state.meta.variables.find(
      item => item.code === variableCode
    );

  if (!variable) return;

  const selected =
    state.selections[variableCode] || [];

  document
    .querySelectorAll(
      `input[data-variable="${CSS.escape(variableCode)}"]`
    )
    .forEach(input => {
      input.checked =
        selected.includes(input.dataset.value);
    });

  updateSelectionCount(variableCode);
}


/* =========================================================
   CONSULTAR DATOS
   ========================================================= */

async function loadTableData() {
  const resultBox =
    document.querySelector('#table-result');

  const statusBox =
    document.querySelector('#api-status');

  const showButton =
    document.querySelector('#show-table');

  const csvButton =
    document.querySelector('#download-csv');

  const excelButton =
    document.querySelector('#download-excel');


  /*
   * Comprobamos que cada variable tenga
   * al menos una categoría seleccionada.
   */
  const emptyVariables =
    (state.meta.variables || [])
      .filter(variable => {
        const selected =
          state.selections[variable.code] || [];

        return selected.length === 0;
      });


  if (emptyVariables.length) {

    resultBox.innerHTML = `
      <div class="api-error">
        <strong>Faltan selecciones.</strong>

        <p>
          Debes seleccionar al menos un valor en:
        </p>

        <ul>
          ${
            emptyVariables
              .map(variable =>
                `<li>${esc(variable.text || variable.code)}</li>`
              )
              .join('')
          }
        </ul>

      </div>
    `;

    return;
  }


  showButton.disabled = true;
  csvButton.disabled = true;
  excelButton.disabled = true;

  resultBox.innerHTML = `
    <div class="loading">
      Consultando datos a Eustat…
    </div>
  `;

  statusBox.innerHTML = '';


  const query = buildQuery();

  try {

    const payload =
      await apiData(
        state.table.id,
        query
      );

    /*
     * Aquí ocurre el paso fundamental:
     *
     * respuesta Eustat
     *        ↓
     * JSON-stat 1.2
     *        ↓
     * parseJsonStat12()
     */
    const parsed =
      parseJsonStat12(payload);

    state.result = parsed;

    renderResultTable(parsed);

    csvButton.disabled = false;
    excelButton.disabled = false;

    statusBox.innerHTML = `
      <div class="api-ok">
        Datos obtenidos directamente de la API
        de Eustat.
      </div>
    `;

  } catch (error) {

    state.result = null;

    resultBox.innerHTML = `
      <div class="api-error">

        <strong>
          No se pudieron obtener los datos.
        </strong>

        <p>
          ${esc(error.message)}
        </p>

        <details>
          <summary>Consulta enviada</summary>
          <pre>${esc(JSON.stringify(query, null, 2))}</pre>
        </details>

      </div>
    `;

    statusBox.innerHTML = '';

  } finally {

    showButton.disabled = false;

  }
}


/* =========================================================
   RENDERIZAR TABLA
   ========================================================= */

function renderResultTable(parsed) {
  const resultBox =
    document.querySelector('#table-result');

  if (!parsed.rows.length) {
    resultBox.innerHTML = `
      <div class="table-placeholder">
        La API no devolvió observaciones.
      </div>
    `;

    return;
  }


  const dimensions =
    parsed.dimensions;


  /*
   * Creamos una tabla "larga":
   *
   * Dimensión 1 | Dimensión 2 | ... | Valor
   *
   * Esto es deliberadamente genérico.
   *
   * Más adelante podremos añadir una vista
   * pivotada al estilo Statbank.
   */

  const header = `
    <tr>
      ${
        dimensions
          .map(dimension =>
            `<th>${esc(dimension.label || dimension.id)}</th>`
          )
          .join('')
      }
      <th>Valor</th>
    </tr>
  `;


  const body =
    parsed.rows
      .map(row => `
        <tr>

          ${
            dimensions
              .map(dimension => `
                <td>
                  ${esc(row.values[dimension.id])}
                </td>
              `)
              .join('')
          }

          <td class="numeric">
            ${esc(formatNumber(row.value))}
          </td>

        </tr>
      `)
      .join('');


  resultBox.innerHTML = `
    <div class="result-summary">

      <strong>
        ${parsed.rows.length.toLocaleString('es-ES')}
        observaciones
      </strong>

      <span>
        ${dimensions.length} dimensiones
      </span>

    </div>

    <div class="table-scroll">

      <table class="data-table">

        <thead>
          ${header}
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

function buildApiRequestText() {
  const query =
    buildQuery();

  return JSON.stringify(
    {
      url:
        `${API}/${encodeURIComponent(state.table.id)}`,
      method: 'POST',
      body: {
        ...query,
        response: {
          format: 'json-stat'
        }
      }
    },
    null,
    2
  );
}


async function copyApiQuery() {
  const text =
    buildApiRequestText();

  try {

    await navigator.clipboard.writeText(text);

    showTemporaryMessage(
      'Consulta API copiada al portapapeles.'
    );

  } catch (error) {

    /*
     * Fallback para navegadores que no permitan
     * navigator.clipboard.
     */
    const textarea =
      document.createElement('textarea');

    textarea.value = text;

    document.body.appendChild(textarea);

    textarea.select();

    document.execCommand('copy');

    textarea.remove();

    showTemporaryMessage(
      'Consulta API copiada al portapapeles.'
    );
  }
}


function showTemporaryMessage(message) {
  const status =
    document.querySelector('#api-status');

  if (!status) return;

  status.innerHTML = `
    <div class="api-ok">
      ${esc(message)}
    </div>
  `;

  setTimeout(() => {

    if (status) {
      status.innerHTML = '';
    }

  }, 2500);
}


/* =========================================================
   CSV
   ========================================================= */

function csvEscape(value) {
  const text =
    String(value ?? '');

  if (
    text.includes('"') ||
    text.includes(';') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}


function buildCsv() {
  if (!state.result) {
    return '';
  }

  const dimensions =
    state.result.dimensions;


  const header = [
    ...dimensions.map(
      dimension =>
        dimension.label || dimension.id
    ),
    'Valor'
  ];


  const lines = [
    header.map(csvEscape).join(';')
  ];


  for (const row of state.result.rows) {

    const values = [
      ...dimensions.map(
        dimension =>
          row.values[dimension.id]
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
   * BOM para que Excel reconozca UTF-8.
   */
  return '\uFEFF' + lines.join('\r\n');
}


function downloadBlob(blob, filename) {
  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement('a');

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  link.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
}


function downloadCsv() {
  if (!state.result) return;

  const csv =
    buildCsv();

  const blob =
    new Blob(
      [csv],
      {
        type: 'text/csv;charset=utf-8'
      }
    );

  downloadBlob(
    blob,
    `${state.table.id.replace(/\.px$/i, '')}.csv`
  );
}


/* =========================================================
   EXCEL
   ========================================================= */

/*
 * No necesitamos una librería externa.
 *
 * Generamos un HTML que Excel puede abrir
 * directamente.
 */
function downloadExcel() {
  if (!state.result) return;

  const dimensions =
    state.result.dimensions;


  const header =
    dimensions
      .map(
        dimension =>
          `<th>${esc(dimension.label || dimension.id)}</th>`
      )
      .join('') +
    '<th>Valor</th>';


  const rows =
    state.result.rows
      .map(row => {

        const cells =
          dimensions
            .map(dimension =>
              `<td>${esc(row.values[dimension.id])}</td>`
            )
            .join('');

        return `
          <tr>
            ${cells}
            <td>${esc(formatNumber(row.value))}</td>
          </tr>
        `;
      })
      .join('');


  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          table {
            border-collapse: collapse;
          }

          th, td {
            border: 1px solid #999;
            padding: 5px;
          }

          th {
            font-weight: bold;
          }
        </style>
      </head>

      <body>

        <table>
          <thead>
            <tr>${header}</tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>
        </table>

      </body>
    </html>
  `;


  const blob =
    new Blob(
      [html],
      {
        type: 'application/vnd.ms-excel'
      }
    );


  downloadBlob(
    blob,
    `${state.table.id.replace(/\.px$/i, '')}.xls`
  );
}


/* =========================================================
   PRUEBA DE CORS
   ========================================================= */

async function testApi() {
  const box =
    document.querySelector('#api-test');

  if (!box) return;

  box.innerHTML = `
    <div class="loading">
      Probando conexión con la API de Eustat…
    </div>
  `;

  const lines = [];

  try {

    /*
     * 1. GET catálogo
     */
    const t0 =
      performance.now();

    const response =
      await fetch(
        API,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `GET catálogo API respondió HTTP ${response.status}`
      );
    }

    await response.json();

    lines.push(
      `GET API: OK (${Math.round(performance.now() - t0)} ms)`
    );


    /*
     * 2. GET metadatos
     */
    const first =
      catalog.find(x => x.id) ||
      catalog[0];

    if (!first) {
      throw new Error(
        'No se encontró ninguna tabla en index_es.json'
      );
    }


    const t1 =
      performance.now();

    const metaResponse =
      await fetch(
        `${API}/${encodeURIComponent(first.id)}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }
      );


    if (!metaResponse.ok) {
      throw new Error(
        `GET metadatos respondió HTTP ${metaResponse.status}`
      );
    }


    const meta =
      await metaResponse.json();


    lines.push(
      `GET metadatos: OK (${Math.round(performance.now() - t1)} ms)`
    );


    /*
     * 3. POST mínimo.
     *
     * Seleccionamos el primer valor de cada variable.
     */
    const variables =
      (meta.variables || [])
        .filter(
          variable =>
            variable.values?.length
        )
        .map(variable => ({
          code: variable.code,
          selection: {
            filter: 'item',
            values: [
              variable.values[0]
            ]
          }
        }));


    const t2 =
      performance.now();


    const dataResponse =
      await fetch(
        `${API}/${encodeURIComponent(first.id)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            Accept:
              'application/json'
          },
          body: JSON.stringify({
            query: variables,
            response: {
              format: 'json-stat'
            }
          })
        }
      );


    if (!dataResponse.ok) {
      throw new Error(
        `POST datos respondió HTTP ${dataResponse.status}`
      );
    }


    const payload =
      await dataResponse.json();


    /*
     * Y aquí probamos realmente nuestro
     * parser JSON-stat 1.2.
     */
    const parsed =
      parseJsonStat12(payload);


    lines.push(
      `POST datos: OK (${Math.round(performance.now() - t2)} ms)`
    );

    lines.push(
      `JSON-stat: OK (${parsed.rows.length} observaciones)`
    );


    box.innerHTML = `
      <div class="api-ok">

        <strong>🟢 CORS FUNCIONA</strong>

        <p>
          El navegador puede comunicarse directamente
          con la API de Eustat.
        </p>

        <ul>
          ${
            lines
              .map(line =>
                `<li>${esc(line)}</li>`
              )
              .join('')
          }
        </ul>

        <p>
          Tabla utilizada:
          <strong>${esc(first.id)}</strong>
        </p>

      </div>
    `;

  } catch (error) {

    box.innerHTML = `
      <div class="api-error">

        <strong>
          🔴 La prueba de API ha fallado
        </strong>

        <p>
          ${esc(error.message)}
        </p>

        <ul>
          ${
            lines
              .map(line =>
                `<li>${esc(line)}</li>`
              )
              .join('')
          }
        </ul>

      </div>
    `;
  }
}


/* =========================================================
   CATÁLOGO - RENDER
   ========================================================= */

function renderCatalog() {

  app.innerHTML = `
    <main class="catalog">

      <div class="catalog-inner">

        <h1>Eustat Statbank</h1>

        <p>
          Explora las tablas estadísticas de Eustat
          con una experiencia inspirada en PxWeb 2.
          El catálogo se genera desde el índice local
          y los datos se consultan directamente en
          la API de Eustat.
        </p>


        <div class="search">

          <input
            id="q"
            placeholder="Buscar por título, operación, variable o palabra clave…"
            autocomplete="off"
          >

        </div>


        <div class="api-test-area">

          <button
            class="api-test-button"
            type="button"
            id="api-test-button">

            🧪 Probar conexión con API de Eustat

          </button>

          <div id="api-test"></div>

        </div>


        <div class="catalog-grid">

          <aside class="filters">

            <div class="filter-block">
              Contenido
            </div>

            <div class="filter-block">
              Operación estadística
            </div>

            <div class="filter-block">
              Frecuencia
            </div>

            <div class="filter-block">
              Periodo
            </div>

          </aside>


          <section>

            <div class="results-head">

              <strong id="count">
                ${catalog.length.toLocaleString('es-ES')}
                tablas
              </strong>

              <span>
                Ordenadas por actualización
              </span>

            </div>

            <div id="cards"></div>

          </section>

        </div>

      </div>

    </main>
  `;


  const search =
    document.querySelector('#q');

  search.addEventListener(
    'input',
    () => paintCards(search.value)
  );


  const testButton =
    document.querySelector(
      '#api-test-button'
    );

  if (testButton) {
    testButton.addEventListener(
      'click',
      testApi
    );
  }


  paintCards('');
}


/* =========================================================
   TARJETAS
   ========================================================= */

function paintCards(term) {

  const text =
    term
      .trim()
      .toLocaleLowerCase('es');


  const rows =
    catalog

      .filter(item => {

        if (!text) return true;

        return (
          String(
            item.search_text ||
            item.title ||
            item.text ||
            ''
          )
            .toLocaleLowerCase('es')
            .includes(text)
        );

      })

      .sort(
        (a, b) =>
          String(b.updated || '')
            .localeCompare(
              String(a.updated || '')
            )
      );


  const count =
    document.querySelector('#count');

  if (count) {
    count.textContent =
      `${rows.length.toLocaleString('es-ES')} tablas`;
  }


  const cards =
    document.querySelector('#cards');

  if (!cards) return;


  cards.innerHTML =
    rows
      .slice(0, 100)
      .map(item => `

        <article class="table-card">

          <h2>
            ${esc(item.title || item.text)}
          </h2>

          <p>

            <strong>
              ${esc(item.id)}
            </strong>

            · ${esc(item.first_period || '')}

            ${
              item.last_period
                ? `— ${esc(item.last_period)}`
                : ''
            }

            ${
              item.updated
                ? ` · Actualizada ${esc(fmtDate(item.updated))}`
                : ''
            }

          </p>


          <div class="tags">

            ${
              item.operacion_titulo
                ? `
                  <span class="tag">
                    ${esc(item.operacion_titulo)}
                  </span>
                `
                : ''
            }

            ${
              item.frecuencia
                ? `
                  <span class="tag">
                    ${esc(item.frecuencia)}
                  </span>
                `
                : ''
            }

            ${
              (item.variables || [])
                .slice(0, 5)
                .map(variable =>
                  `
                    <span class="tag">
                      ${esc(
                        variable.text ||
                        variable
                      )}
                    </span>
                  `
                )
                .join('')
            }

          </div>


          <a
            class="open"
            href="#/table/${encodeURIComponent(item.id)}">

            Abrir tabla →

          </a>

        </article>

      `)
      .join('');


  if (!cards.innerHTML) {
    cards.innerHTML =
      '<div class="empty">No se encontraron tablas.</div>';
  }
}


/* =========================================================
   ROUTING
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
      decodeURIComponent(match[1])
    );

    return;
  }


  renderCatalog();
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


  state = {
    meta: null,
    selections: {},
    result: null,
    table
  };


  app.innerHTML = `
    <main class="catalog">

      <div class="catalog-inner">

        <div class="loading">
          Cargando metadatos de la tabla…
        </div>

      </div>

    </main>
  `;


  try {

    state.meta =
      await apiMeta(id);


    if (
      !state.meta ||
      !Array.isArray(state.meta.variables)
    ) {
      throw new Error(
        'La API no devolvió metadatos de tabla reconocibles.'
      );
    }


    state.selections =
      initializeSelections(
        state.meta
      );


    renderTablePage();


  } catch (error) {

    app.innerHTML = `
      <main class="catalog">

        <div class="catalog-inner">

          <div class="api-error">

            <strong>
              No se pudieron cargar los metadatos.
            </strong>

            <p>
              ${esc(error.message)}
            </p>

          </div>

        </div>

      </main>
    `;
  }
}


/* =========================================================
   INICIO
   ========================================================= */

loadCatalog()

  .then(() => route())

  .catch(error => {

    app.innerHTML = `
      <main class="catalog">

        <div class="catalog-inner">

          <div class="error">

            No se pudo cargar el catálogo:

            ${esc(error.message)}

          </div>

        </div>

      </main>
    `;

  });


window.addEventListener(
  'hashchange',
  route
);
