const API = 'https://www.eustat.eus/bankupx/api/v1/es/DB';
const DATA = './data/index_es.json';

const app = document.querySelector('#app');

let catalog = [];

let state = {
  table: null,
  meta: null,
  selections: {},
  result: null,
  query: null
};


/* =========================================================
   UTILIDADES
   ========================================================= */

function esc(value) {
  return String(value ?? '')
    .replace(/[&<>"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[char]));
}


function fmtDate(value) {
  if (!value) return '';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}


function formatNumber(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return value.toLocaleString('es-ES', {
      maximumFractionDigits: 10
    });
  }

  return String(value);
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/* =========================================================
   ESTILOS
   No necesitamos modificar CSS para que la nueva pantalla
   funcione. Estos estilos se añaden automáticamente.
   ========================================================= */

function ensureStyles() {

  if (document.querySelector('#eustatbank-runtime-styles')) {
    return;
  }

  const style = document.createElement('style');

  style.id = 'eustatbank-runtime-styles';

  style.textContent = `
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      color: #102f3a;
      background: #ffffff;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button {
      cursor: pointer;
    }

    .eb-page {
      min-height: calc(100vh - 70px);
      background: #ffffff;
    }

    .eb-banner {
      background: #c7e8fa;
      border-bottom: 1px solid #9fd1e8;
      padding: 15px 28px;
      color: #173b49;
    }

    .eb-container {
      max-width: 1500px;
      margin: 0 auto;
      padding: 34px 38px;
    }

    .eb-breadcrumb {
      color: #42616d;
      font-size: 14px;
      margin-bottom: 26px;
    }

    .eb-breadcrumb a {
      color: #164f68;
      text-decoration: underline;
    }

    .eb-title {
      font-size: 34px;
      line-height: 1.2;
      margin: 0 0 18px;
      color: #092f42;
    }

    .eb-subtitle {
      color: #526b75;
      margin: 0 0 28px;
    }

    .eb-layout {
      display: grid;
      grid-template-columns: 330px minmax(0, 1fr);
      gap: 30px;
      align-items: start;
    }

    .eb-sidebar {
      background: #eef8fa;
      padding: 24px;
      border-radius: 4px;
    }

    .eb-sidebar h2 {
      margin: 0 0 22px;
      font-size: 25px;
    }

    .eb-variable {
      background: white;
      border-radius: 12px;
      margin-bottom: 16px;
      padding: 18px;
      border: 1px solid #e0ecef;
    }

    .eb-variable-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 10px;
      color: #153c4b;
    }

    .eb-variable-info {
      font-size: 13px;
      color: #55717b;
      margin-bottom: 12px;
    }

    .eb-actions-small {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .eb-small-button {
      border: 0;
      background: #e6f1f3;
      color: #123e4b;
      border-radius: 5px;
      padding: 6px 10px;
      font-size: 13px;
    }

    .eb-small-button:hover {
      background: #d4e8ec;
    }

    .eb-values {
      max-height: 260px;
      overflow-y: auto;
      border: 1px solid #bdd2d8;
      border-radius: 7px;
      background: #fff;
    }

    .eb-value {
      display: flex;
      gap: 9px;
      align-items: flex-start;
      padding: 8px 10px;
      font-size: 14px;
      cursor: pointer;
    }

    .eb-value:hover {
      background: #f1f8fa;
    }

    .eb-value input {
      margin-top: 3px;
      accent-color: #155f6d;
    }

    .eb-main {
      min-width: 0;
    }

    .eb-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 25px;
    }

    .eb-button {
      border: 1px solid #214c59;
      background: white;
      color: #153e4b;
      border-radius: 24px;
      padding: 9px 17px;
      font-weight: 600;
    }

    .eb-button:hover {
      background: #edf7f8;
    }

    .eb-button-primary {
      background: #143f4b;
      color: white;
      border-color: #143f4b;
    }

    .eb-button-primary:hover {
      background: #0d303a;
    }

    .eb-status {
      padding: 15px 18px;
      background: #f1f7f8;
      border-left: 4px solid #75aeb9;
      margin-bottom: 22px;
      color: #3e5962;
    }

    .eb-error {
      padding: 18px;
      background: #fff1f1;
      border-left: 4px solid #b33b3b;
      color: #6b2020;
      margin-bottom: 22px;
      white-space: pre-wrap;
    }

    .eb-loading {
      padding: 35px;
      text-align: center;
      color: #4e6872;
    }

    .eb-table-wrap {
      overflow: auto;
      max-width: 100%;
      border: 1px solid #9bb2b8;
    }

    .eb-result-table {
      border-collapse: collapse;
      width: 100%;
      min-width: 700px;
      background: white;
    }

    .eb-result-table th {
      background: #dcecef;
      color: #153b48;
      border: 1px solid #7d989f;
      padding: 10px 12px;
      text-align: left;
      font-weight: 700;
      white-space: nowrap;
    }

    .eb-result-table td {
      border: 1px solid #9bb2b8;
      padding: 8px 12px;
      text-align: right;
      white-space: nowrap;
    }

    .eb-result-table td:first-child,
    .eb-result-table td.eb-label {
      text-align: left;
    }

    .eb-result-table tr:nth-child(even) td {
      background: #f8fbfc;
    }

    .eb-empty {
      padding: 35px;
      text-align: center;
      color: #647b83;
    }

    .eb-card {
      border: 1px solid #c6d9dd;
      border-radius: 15px;
      padding: 22px;
      margin-bottom: 14px;
      background: white;
    }

    .eb-card h2 {
      font-size: 20px;
      margin: 0 0 8px;
      color: #103746;
    }

    .eb-card p {
      color: #637a82;
      font-size: 14px;
    }

    .eb-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin: 13px 0;
    }

    .eb-tag {
      border: 1px solid #c5d9de;
      border-radius: 20px;
      padding: 5px 9px;
      font-size: 12px;
      color: #285564;
      background: #f7fbfc;
    }

    .eb-open {
      color: #07566d;
      font-weight: 700;
      text-decoration: underline;
    }

    .eb-search {
      width: 100%;
      padding: 15px 17px;
      border: 2px solid #294b56;
      border-radius: 7px;
      margin-bottom: 28px;
      font-size: 16px;
    }

    .eb-count {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 15px;
      color: #4f6871;
    }

    .eb-count strong {
      color: #153d4b;
      font-size: 18px;
    }

    .eb-back {
      margin-bottom: 22px;
    }

    .eb-code {
      margin-top: 20px;
      background: #f4f7f8;
      border: 1px solid #d4e0e3;
      border-radius: 7px;
      padding: 15px;
      overflow: auto;
      font-size: 12px;
      white-space: pre-wrap;
    }

    .eb-check-summary {
      background: #e4f0f2;
      display: inline-block;
      padding: 5px 8px;
      border-radius: 5px;
      font-size: 12px;
      margin-bottom: 10px;
    }

    @media (max-width: 900px) {
      .eb-layout {
        grid-template-columns: 1fr;
      }

      .eb-container {
        padding: 22px 16px;
      }

      .eb-sidebar {
        padding: 16px;
      }
    }
  `;

  document.head.appendChild(style);
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

  catalog = Array.isArray(json)
    ? json
    : (json.data || []);
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
        query,
        response: {
          format: 'json-stat'
        }
      })
    }
  );

  const text = await response.text();

  if (!response.ok) {

    let message = text;

    try {
      const json = JSON.parse(text);
      message =
        json.message ||
        json.error ||
        JSON.stringify(json);
    } catch (_) {}

    throw new Error(
      `La consulta ha fallado (${response.status}).\n\n${message}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(
      'Eustat respondió, pero la respuesta no es JSON válido.\n\n' +
      text.slice(0, 1000)
    );
  }
}


/* =========================================================
   METADATOS
   ========================================================= */

function getVariables(meta) {

  if (!meta || !Array.isArray(meta.variables)) {
    throw new Error(
      'La API respondió, pero no se encontraron variables en los metadatos.'
    );
  }

  return meta.variables;
}


function valueLabel(variable, value) {

  const index =
    Array.isArray(variable.values)
      ? variable.values.indexOf(value)
      : -1;

  if (
    index >= 0 &&
    Array.isArray(variable.valueTexts) &&
    variable.valueTexts[index] !== undefined
  ) {
    return variable.valueTexts[index];
  }

  if (
    index >= 0 &&
    Array.isArray(variable.texts) &&
    variable.texts[index] !== undefined
  ) {
    return variable.texts[index];
  }

  if (
    variable.valueTexts &&
    typeof variable.valueTexts === 'object' &&
    variable.valueTexts[value] !== undefined
  ) {
    return variable.valueTexts[value];
  }

  return value;
}


/* =========================================================
   SELECCIONES
   ========================================================= */

function initializeSelections(variables) {

  state.selections = {};

  for (const variable of variables) {

    const values = variable.values || [];

    /*
      Por defecto seleccionamos el primer valor.
      Esto evita pedir accidentalmente millones de celdas.
    */

    state.selections[variable.code] =
      values.length
        ? [values[0]]
        : [];
  }
}


function getSelectedValues(code) {

  return state.selections[code] || [];
}


function setSelectedValues(code, values) {

  state.selections[code] = [...values];

  updateVariableSummary(code);
}


function selectAll(code) {

  const variable =
    state.meta.variables.find(v => v.code === code);

  if (!variable) return;

  setSelectedValues(
    code,
    [...(variable.values || [])]
  );

  renderChecks(code);
}


function selectNone(code) {

  setSelectedValues(code, []);

  renderChecks(code);
}


function renderChecks(code) {

  const container =
    document.querySelector(
      `[data-values="${CSS.escape(code)}"]`
    );

  if (!container) return;

  const selected =
    new Set(getSelectedValues(code));

  container
    .querySelectorAll('input[type="checkbox"]')
    .forEach(input => {
      input.checked =
        selected.has(input.value);
    });

  updateVariableSummary(code);
}


function updateVariableSummary(code) {

  const element =
    document.querySelector(
      `[data-summary="${CSS.escape(code)}"]`
    );

  if (!element) return;

  const selected =
    getSelectedValues(code);

  const variable =
    state.meta?.variables?.find(v => v.code === code);

  const total =
    variable?.values?.length || 0;

  element.textContent =
    `${selected.length} de ${total} seleccionados`;
}


/* =========================================================
   PANTALLA DE TABLA
   ========================================================= */

async function openTable(id) {

  const table =
    catalog.find(x => x.id === id);

  if (!table) {

    location.hash = '#/';

    return;
  }

  state = {
    table,
    meta: null,
    selections: {},
    result: null,
    query: null
  };

  renderTableLoading(table);

  try {

    state.meta = await apiMeta(id);

    const variables =
      getVariables(state.meta);

    initializeSelections(variables);

    renderTableSelector();

  } catch (error) {

    renderTableError(
      table,
      error
    );
  }
}


/* =========================================================
   SELECTOR DE VARIABLES
   ========================================================= */

function renderTableSelector() {

  const variables =
    getVariables(state.meta);

  const title =
    state.meta.title ||
    state.table.title ||
    state.table.text ||
    state.table.id;

  const updated =
    state.table.updated || '';

  app.innerHTML = `
    <div class="eb-page">

      <div class="eb-banner">
        ℹ️ Consulta datos directamente desde la API pública de Eustat.
      </div>

      <div class="eb-container">

        <div class="eb-breadcrumb">
          <a href="#/">Tablas</a>
          &nbsp;›&nbsp;
          ${esc(title)}
        </div>

        <div class="eb-back">
          <button
            class="eb-button"
            id="backCatalog"
          >
            ← Volver a tablas
          </button>
        </div>

        <h1 class="eb-title">
          ${esc(title)}
        </h1>

        <p class="eb-subtitle">
          ${updated
            ? `Actualizada: ${esc(fmtDate(updated))}`
            : 'Datos actualizados directamente desde Eustat'}
        </p>

        <div class="eb-layout">

          <aside class="eb-sidebar">

            <h2>Filtro</h2>

            ${variables
              .map(renderVariable)
              .join('')}

          </aside>

          <main class="eb-main">

            <div class="eb-toolbar">

              <button
                class="eb-button eb-button-primary"
                id="showTable"
              >
                Mostrar tabla
              </button>

              <button
                class="eb-button"
                id="downloadCsv"
                disabled
              >
                CSV
              </button>

              <button
                class="eb-button"
                id="downloadExcel"
                disabled
              >
                Excel
              </button>

              <button
                class="eb-button"
                id="copyApi"
              >
                Copiar consulta API
              </button>

            </div>

            <div id="resultArea">

              <div class="eb-status">
                Selecciona los valores que quieras consultar
                y pulsa <strong>Mostrar tabla</strong>.
              </div>

            </div>

          </main>

        </div>

      </div>

    </div>
  `;

  document
    .querySelector('#backCatalog')
    .addEventListener(
      'click',
      () => {
        location.hash = '#/';
      }
    );


  document
    .querySelector('#showTable')
    .addEventListener(
      'click',
      runQuery
    );


  document
    .querySelector('#downloadCsv')
    .addEventListener(
      'click',
      downloadCSV
    );


  document
    .querySelector('#downloadExcel')
    .addEventListener(
      'click',
      downloadExcel
    );


  document
    .querySelector('#copyApi')
    .addEventListener(
      'click',
      copyApiQuery
    );


  /*
    Activamos los botones "Todos" / "Ninguno"
    y los checkboxes.
  */

  for (const variable of variables) {

    const code = variable.code;

    const allButton =
      document.querySelector(
        `[data-all="${CSS.escape(code)}"]`
      );

    const noneButton =
      document.querySelector(
        `[data-none="${CSS.escape(code)}"]`
      );

    if (allButton) {
      allButton.addEventListener(
        'click',
        () => selectAll(code)
      );
    }

    if (noneButton) {
      noneButton.addEventListener(
        'click',
        () => selectNone(code)
      );
    }

    const container =
      document.querySelector(
        `[data-values="${CSS.escape(code)}"]`
      );

    if (container) {

      container
        .querySelectorAll('input[type="checkbox"]')
        .forEach(input => {

          input.addEventListener(
            'change',
            () => {

              const selected =
                Array.from(
                  container.querySelectorAll(
                    'input[type="checkbox"]:checked'
                  )
                )
                .map(x => x.value);

              setSelectedValues(
                code,
                selected
              );
            }
          );

        });
    }
  }
}


function renderVariable(variable) {

  const code = variable.code;

  const values =
    variable.values || [];

  const selected =
    getSelectedValues(code);

  const mandatory =
    variable.time ||
    variable.elimination ||
    true;

  return `
    <section class="eb-variable">

      <div class="eb-variable-title">
        ${esc(variable.text || code)}
      </div>

      <div
        class="eb-check-summary"
        data-summary="${esc(code)}"
      >
        ${selected.length}
        de
        ${values.length}
        seleccionados
      </div>

      <div class="eb-actions-small">

        <button
          type="button"
          class="eb-small-button"
          data-all="${esc(code)}"
        >
          Todos
        </button>

        <button
          type="button"
          class="eb-small-button"
          data-none="${esc(code)}"
        >
          Ninguno
        </button>

      </div>

      <div
        class="eb-values"
        data-values="${esc(code)}"
      >

        ${values.map((value, index) => {

          const checked =
            selected.includes(String(value))
              ? 'checked'
              : '';

          const label =
            Array.isArray(variable.valueTexts)
              ? (
                  variable.valueTexts[index] ??
                  value
                )
              : valueLabel(variable, value);

          return `
            <label class="eb-value">

              <input
                type="checkbox"
                value="${esc(value)}"
                ${checked}
              >

              <span>
                ${esc(label)}
              </span>

            </label>
          `;

        }).join('')}

      </div>

    </section>
  `;
}


/* =========================================================
   EJECUTAR CONSULTA
   ========================================================= */

async function runQuery() {

  const variables =
    getVariables(state.meta);

  /*
    Comprobamos que todas las variables tienen
    al menos una selección.
  */

  const empty =
    variables.filter(
      v =>
        !(state.selections[v.code] || []).length
    );

  if (empty.length) {

    renderResultError(
      'Falta seleccionar al menos un valor en: ' +
      empty.map(v => v.text || v.code).join(', ')
    );

    return;
  }


  const query =
    variables.map(variable => ({
      code: variable.code,
      selection: {
        filter: 'item',
        values:
          state.selections[variable.code] || []
      }
    }));


  state.query = query;

  const resultArea =
    document.querySelector('#resultArea');

  resultArea.innerHTML = `
    <div class="eb-loading">
      Consultando datos de Eustat…
    </div>
  `;


  const button =
    document.querySelector('#showTable');

  if (button) {
    button.disabled = true;
    button.textContent = 'Consultando…';
  }


  try {

    const result =
      await apiData(
        state.table.id,
        query
      );

    state.result = result;

    renderJSONStatResult(result);

    const csvButton =
      document.querySelector('#downloadCsv');

    const excelButton =
      document.querySelector('#downloadExcel');

    if (csvButton) {
      csvButton.disabled = false;
    }

    if (excelButton) {
      excelButton.disabled = false;
    }

  } catch (error) {

    renderResultError(
      error.message
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = 'Mostrar tabla';
    }
  }
}


/* =========================================================
   JSON-STAT
   ========================================================= */

/*
  Eustat documenta JSON-stat 1.2 como formato
  predeterminado.

  Esta función convierte:

      id
      size
      dimension
      value

  en una matriz de filas.
*/


function parseJSONStat(dataset) {

  if (!dataset || typeof dataset !== 'object') {
    throw new Error(
      'La API no devolvió un objeto JSON-stat reconocible.'
    );
  }


  if (
    !Array.isArray(dataset.id) ||
    !Array.isArray(dataset.size) ||
    !dataset.dimension
  ) {

    throw new Error(
      'La API respondió, pero el JSON recibido no tiene la estructura JSON-stat esperada.\n\n' +
      JSON.stringify(dataset, null, 2).slice(0, 4000)
    );
  }


  const ids =
    dataset.id;

  const sizes =
    dataset.size;

  const dimensions =
    dataset.dimension;


  /*
    Obtener categorías de cada dimensión.
  */

  const categories =
    ids.map(id => {

      const dimension =
        dimensions[id];

      if (!dimension) {
        return [];
      }

      const category =
        dimension.category || {};

      const index =
        category.index;

      let codes = [];

      if (Array.isArray(index)) {

        codes = index;

      } else if (
        index &&
        typeof index === 'object'
      ) {

        codes =
          Object.entries(index)
            .sort(
              (a, b) => a[1] - b[1]
            )
            .map(
              x => x[0]
            );

      } else if (
        Array.isArray(category.label)
      ) {

        codes =
          category.label.map(
            (_, i) => String(i)
          );

      } else {

        codes =
          Object.keys(
            category.label || {}
          );
      }


      return codes.map(code => {

        let label = code;

        if (
          category.label &&
          typeof category.label === 'object'
        ) {

          label =
            category.label[code] ??
            code;
        }

        return {
          code,
          label
        };

      });

    });


  const values =
    Array.isArray(dataset.value)
      ? dataset.value
      : [];


  /*
    Número total de celdas.
  */

  const total =
    sizes.reduce(
      (a, b) => a * b,
      1
    );


  /*
    JSON-stat utiliza un array plano.
  */

  const rows = [];


  for (
    let flatIndex = 0;
    flatIndex < total;
    flatIndex++
  ) {

    const coordinates =
      flatToCoordinates(
        flatIndex,
        sizes
      );


    const row = {};

    ids.forEach(
      (id, dimensionIndex) => {

        const category =
          categories[dimensionIndex]
            [coordinates[dimensionIndex]];

        row[id] = {
          code: category?.code ?? '',
          label: category?.label ?? ''
        };

      }
    );


    row.__value =
      values[flatIndex] ?? null;


    rows.push(row);
  }


  return {
    ids,
    sizes,
    dimensions,
    categories,
    rows
  };
}


function flatToCoordinates(
  index,
  sizes
) {

  const coordinates =
    new Array(
      sizes.length
    );

  let remainder = index;


  for (
    let i = sizes.length - 1;
    i >= 0;
    i--
  ) {

    coordinates[i] =
      remainder % sizes[i];

    remainder =
      Math.floor(
        remainder / sizes[i]
      );
  }


  return coordinates;
}


/* =========================================================
   MOSTRAR JSON-STAT COMO TABLA
   ========================================================= */

function renderJSONStatResult(dataset) {

  const parsed =
    parseJSONStat(dataset);

  const {
    ids,
    rows
  } = parsed;


  if (!rows.length) {

    document.querySelector('#resultArea').innerHTML = `
      <div class="eb-empty">
        La consulta no contiene datos.
      </div>
    `;

    return;
  }


  /*
    Para una tabla multidimensional:

      dimensiones excepto la última
          → filas

      última dimensión
          → columnas

    Es una representación sencilla y muy parecida
    a una tabla estadística tradicional.
  */

  const rowDimensions =
    ids.slice(0, -1);

  const columnDimension =
    ids[ids.length - 1];


  const columnValues =
    parsed.categories[
      ids.length - 1
    ] || [];


  /*
    Agrupamos las filas por las dimensiones
    que no son columnas.
  */

  const groups =
    new Map();


  for (const row of rows) {

    const key =
      rowDimensions
        .map(
          id => row[id].code
        )
        .join('|||');


    if (!groups.has(key)) {

      groups.set(
        key,
        {
          dimensions: row,
          values: {}
        }
      );

    }


    groups
      .get(key)
      .values[
        row[columnDimension].code
      ] =
      row.__value;
  }


  let html = `
    <div class="eb-status">

      <strong>
        Resultado:
      </strong>

      ${rows.length.toLocaleString('es-ES')}
      celdas recibidas.

    </div>

    <div class="eb-table-wrap">

      <table class="eb-result-table">

        <thead>

          <tr>

            ${rowDimensions
              .map(
                id =>
                  `<th>${esc(
                    getDimensionLabel(
                      parsed,
                      id
                    )
                  )}</th>`
              )
              .join('')}

            ${columnValues
              .map(
                value =>
                  `<th>${esc(
                    value.label
                  )}</th>`
              )
              .join('')}

          </tr>

        </thead>

        <tbody>
  `;


  for (const group of groups.values()) {

    html += '<tr>';


    for (const id of rowDimensions) {

      html += `
        <td class="eb-label">
          ${esc(group.dimensions[id].label)}
        </td>
      `;
    }


    for (const column of columnValues) {

      const value =
        group.values[column.code];


      html += `
        <td>
          ${formatNumber(value)}
        </td>
      `;
    }


    html += '</tr>';
  }


  html += `
        </tbody>

      </table>

    </div>
  `;


  document.querySelector('#resultArea')
    .innerHTML = html;
}


function getDimensionLabel(parsed, id) {

  const dimension =
    parsed.dimensions[id];

  return (
    dimension?.label ||
    dimension?.text ||
    id
  );
}


/* =========================================================
   CSV
   ========================================================= */

function escapeCSV(value) {

  const text =
    String(value ?? '');

  return `"${text.replace(/"/g, '""')}"`;
}


function buildCSV() {

  const parsed =
    parseJSONStat(state.result);

  const {
    ids,
    rows
  } = parsed;


  const headers =
    [
      ...ids.map(
        id => getDimensionLabel(parsed, id)
      ),
      'Valor'
    ];


  const lines = [
    headers.map(escapeCSV).join(';')
  ];


  for (const row of rows) {

    lines.push(
      [
        ...ids.map(
          id => row[id].label
        ),
        row.__value
      ]
        .map(escapeCSV)
        .join(';')
    );
  }


  return '\ufeff' + lines.join('\r\n');
}


function downloadCSV() {

  if (!state.result) return;

  const csv =
    buildCSV();


  const blob =
    new Blob(
      [csv],
      {
        type:
          'text/csv;charset=utf-8;'
      }
    );


  downloadBlob(
    blob,
    `${safeFilename(state.table.id)}.csv`
  );
}


/* =========================================================
   EXCEL
   ========================================================= */

/*
  Generamos una hoja HTML que Excel puede abrir.
  No necesitamos instalar ninguna biblioteca.
*/

function buildExcelHTML() {

  const parsed =
    parseJSONStat(state.result);

  const {
    ids,
    rows
  } = parsed;


  let html = `
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body>

      <table border="1">

        <tr>

          ${ids
            .map(
              id =>
                `<th>${esc(
                  getDimensionLabel(
                    parsed,
                    id
                  )
                )}</th>`
            )
            .join('')}

          <th>Valor</th>

        </tr>
  `;


  for (const row of rows) {

    html += '<tr>';


    for (const id of ids) {

      html += `
        <td>
          ${esc(row[id].label)}
        </td>
      `;
    }


    html += `
      <td>
        ${esc(row.__value)}
      </td>
    `;


    html += '</tr>';
  }


  html += `
      </table>

    </body>
    </html>
  `;


  return html;
}


function downloadExcel() {

  if (!state.result) return;


  const html =
    buildExcelHTML();


  const blob =
    new Blob(
      [html],
      {
        type:
          'application/vnd.ms-excel'
      }
    );


  downloadBlob(
    blob,
    `${safeFilename(state.table.id)}.xls`
  );
}


/* =========================================================
   COPIAR CONSULTA API
   ========================================================= */

function buildApiRequest() {

  return {
    url:
      `${API}/${encodeURIComponent(state.table.id)}`,

    method:
      'POST',

    body: {
      query:
        state.query || [],

      response: {
        format: 'json-stat'
      }
    }
  };
}


async function copyApiQuery() {

  if (!state.meta) return;


  /*
    Si todavía no hemos pulsado "Mostrar tabla",
    generamos la consulta con las selecciones actuales.
  */

  const variables =
    getVariables(state.meta);


  const query =
    variables.map(variable => ({
      code: variable.code,

      selection: {
        filter: 'item',

        values:
          state.selections[
            variable.code
          ] || []
      }
    }));


  const request = {

    url:
      `${API}/${encodeURIComponent(state.table.id)}`,

    method:
      'POST',

    headers: {
      'Content-Type':
        'application/json',

      Accept:
        'application/json'
    },

    body: {
      query,

      response: {
        format: 'json-stat'
      }
    }
  };


  const text =
    JSON.stringify(
      request,
      null,
      2
    );


  try {

    await navigator.clipboard.writeText(
      text
    );

    showTemporaryMessage(
      'Consulta API copiada al portapapeles.'
    );

  } catch (_) {

    /*
      Fallback para navegadores que no permiten
      navigator.clipboard.
    */

    window.prompt(
      'Copia la consulta API:',
      text
    );
  }
}


/* =========================================================
   DESCARGAS
   ========================================================= */

function downloadBlob(
  blob,
  filename
) {

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


function safeFilename(value) {

  return String(value || 'eustat')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(0, 120);
}


/* =========================================================
   MENSAJES
   ========================================================= */

function renderTableLoading(table) {

  app.innerHTML = `
    <div class="eb-page">

      <div class="eb-container">

        <div class="eb-loading">
          <h2>
            Cargando tabla…
          </h2>

          <p>
            Consultando los metadatos de Eustat.
          </p>

        </div>

      </div>

    </div>
  `;
}


function renderTableError(
  table,
  error
) {

  app.innerHTML = `
    <div class="eb-page">

      <div class="eb-container">

        <button
          class="eb-button"
          onclick="location.hash='#/'"
        >
          ← Volver a tablas
        </button>

        <h1 class="eb-title">
          ${esc(
            table.title ||
            table.text ||
            table.id
          )}
        </h1>

        <div class="eb-error">

          <strong>
            No se pudo consultar la tabla.
          </strong>

          <br><br>

          ${esc(error.message)}

        </div>

      </div>

    </div>
  `;
}


function renderResultError(message) {

  const area =
    document.querySelector('#resultArea');

  if (!area) return;

  area.innerHTML = `
    <div class="eb-error">

      <strong>
        No se pudieron obtener los datos.
      </strong>

      <br><br>

      ${esc(message)}

    </div>
  `;
}


function showTemporaryMessage(message) {

  const existing =
    document.querySelector('.eb-temporary-message');

  if (existing) {
    existing.remove();
  }


  const element =
    document.createElement('div');

  element.className =
    'eb-status eb-temporary-message';

  element.style.position =
    'fixed';

  element.style.right =
    '20px';

  element.style.bottom =
    '20px';

  element.style.zIndex =
    '9999';

  element.textContent =
    message;


  document.body.appendChild(
    element
  );


  setTimeout(
    () => element.remove(),
    2500
  );
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

function renderCatalog() {

  app.innerHTML = `
    <main class="eb-page">

      <div class="eb-container">

        <h1 class="eb-title">
          Eustat Statbank
        </h1>

        <p class="eb-subtitle">
          Explora las tablas estadísticas de Eustat.
          Selecciona una tabla para consultar sus datos
          directamente desde la API pública.
        </p>

        <input
          id="q"
          class="eb-search"
          placeholder="Buscar por título, operación, variable o palabra clave…"
          autocomplete="off"
        >

        <div class="eb-count">

          <strong id="count">
            ${catalog.length.toLocaleString('es-ES')}
            tablas
          </strong>

          <span>
            Ordenadas por actualización
          </span>

        </div>

        <div id="cards"></div>

      </div>

    </main>
  `;


  const input =
    document.querySelector('#q');


  input.addEventListener(
    'input',
    () => paintCards(input.value)
  );


  paintCards('');
}


function paintCards(term) {

  const text =
    term
      .trim()
      .toLocaleLowerCase('es');


  const rows =
    catalog
      .filter(item => {

        const searchable =
          item.search_text ||
          item.title ||
          item.text ||
          '';


        return (
          !text ||
          searchable
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


  if (!rows.length) {

    cards.innerHTML = `
      <div class="eb-empty">
        No se encontraron tablas.
      </div>
    `;

    return;
  }


  cards.innerHTML =
    rows
      .slice(0, 100)
      .map(item => {

        const title =
          item.title ||
          item.text ||
          item.id;


        const variables =
          item.variables || [];


        return `
          <article class="eb-card">

            <h2>
              ${esc(title)}
            </h2>

            <p>

              <strong>
                ${esc(item.id)}
              </strong>

              ${item.first_period
                ? ` · ${esc(item.first_period)}`
                : ''}

              ${item.last_period
                ? ` — ${esc(item.last_period)}`
                : ''}

              ${item.updated
                ? ` · Actualizada ${esc(
                    fmtDate(item.updated)
                  )}`
                : ''}

            </p>

            <div class="eb-tags">

              ${
                item.operacion_titulo
                  ? `
                    <span class="eb-tag">
                      ${esc(
                        item.operacion_titulo
                      )}
                    </span>
                  `
                  : ''
              }

              ${
                item.frecuencia
                  ? `
                    <span class="eb-tag">
                      ${esc(
                        item.frecuencia
                      )}
                    </span>
                  `
                  : ''
              }

              ${variables
                .slice(0, 6)
                .map(variable => `
                  <span class="eb-tag">
                    ${esc(
                      variable.text ||
                      variable
                    )}
                  </span>
                `)
                .join('')}

            </div>

            <a
              class="eb-open"
              href="#/table/${encodeURIComponent(item.id)}"
            >
              Abrir tabla →
            </a>

          </article>
        `;

      })
      .join('');
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

async function init() {

  ensureStyles();

  try {

    await loadCatalog();

    route();

  } catch (error) {

    app.innerHTML = `
      <main class="eb-page">

        <div class="eb-container">

          <div class="eb-error">

            <strong>
              No se pudo cargar Eustatbank.
            </strong>

            <br><br>

            ${esc(error.message)}

          </div>

        </div>

      </main>
    `;
  }
}


window.addEventListener(
  'hashchange',
  route
);


init();
