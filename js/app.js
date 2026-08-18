
/* ============================================================
   EUSTATBANK
   Front-end directo contra la API PXWeb/JSON-stat de Eustat
   ============================================================ */

const API = 'https://www.eustat.eus/bankupx/api/v1/es/DB';
const DATA = './data/index_es.json';

const app = document.querySelector('#app');

let catalog = [];

let state = {
  table: null,
  meta: null,
  selections: {},
  result: null,
  query: null,
  loading: false,
  error: null
};


/* ============================================================
   UTILIDADES
   ============================================================ */

function esc(value) {
  return String(value ?? '')
    .replace(/[&<>"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[char]));
}


function parseDate(value) {
  if (!value) return 0;

  const s = String(value).trim();

  /* ISO */
  const iso = Date.parse(s);

  if (!Number.isNaN(iso)) {
    return iso;
  }

  /*
     Fechas tipo:
     9/1/2023
     17/2/2021
     03/08/2026
  */
  const m = s.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/
  );

  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);

    return new Date(
      year,
      month,
      day
    ).getTime();
  }

  return 0;
}


function formatDate(value) {
  if (!value) return '';

  const timestamp = parseDate(value);

  if (!timestamp) {
    return String(value);
  }

  return new Date(timestamp).toLocaleDateString(
    'es-ES'
  );
}


function isTimeVariable(variable) {
  return Boolean(variable?.time);
}


/* ============================================================
   CATÁLOGO
   ============================================================ */

async function loadCatalog() {

  const response = await fetch(DATA, {
    cache: 'no-cache'
  });

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar el catálogo (${response.status})`
    );
  }

  const json = await response.json();

  catalog = Array.isArray(json.data)
    ? json.data
    : [];

  /*
     Ordenamos aquí también, para que el catálogo ya nazca
     correctamente ordenado.
  */
  catalog.sort(
    (a, b) =>
      parseDate(b.updated) -
      parseDate(a.updated)
  );
}


/* ============================================================
   API - METADATOS
   ============================================================ */

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

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Error obteniendo metadatos (${response.status}): ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'La API devolvió unos metadatos que no son JSON válido.'
    );
  }
}


/* ============================================================
   API - DATOS
   ============================================================ */

async function apiData(id, query) {

  const body = {
    query,
    response: {
      format: 'json-stat'
    }
  };

  const response = await fetch(
    `${API}/${encodeURIComponent(id)}`,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },

      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {

    const error = new Error(
      `La API respondió HTTP ${response.status}`
    );

    error.status = response.status;
    error.raw = text;
    error.body = json;

    throw error;
  }

  if (!json) {

    const error = new Error(
      'La API respondió, pero no devolvió JSON válido.'
    );

    error.raw = text;

    throw error;
  }

  return json;
}


/* ============================================================
   JSON-STAT 1.2
   ============================================================ */

/*
   Eustat devuelve algo de esta forma:

   {
     "dataset": {
       "dimension": {
         "Sector": {
           "category": {
             "index": {
               "100": 0
             },
             "label": {
               "100": "1. Índice general"
             }
           }
         }
       },

       "id": [
         "Sector",
         "Tipo de medida",
         "Precios",
         "periodo"
       ],

       "size": [
         1,
         1,
         1,
         5
       ],

       "value": [
         100,
         104.5,
         107.8,
         111.1,
         115
       ]
     }
   }
*/


function getDataset(json) {

  /*
     Eustat normalmente envuelve el dataset en
     { dataset: {...} }.

     Dejamos también soporte para que venga directamente
     como dataset.
  */

  if (
    json &&
    json.dataset &&
    typeof json.dataset === 'object'
  ) {
    return json.dataset;
  }

  if (
    json &&
    json.dimension &&
    Array.isArray(json.id)
  ) {
    return json;
  }

  return null;
}


function orderedCategoryCodes(dimension) {

  const category =
    dimension?.category || {};

  const index =
    category.index;

  /*
     Caso normal JSON-stat:
       {
         "100": 0,
         "110": 1,
         "120": 2
       }
  */

  if (
    index &&
    typeof index === 'object' &&
    !Array.isArray(index)
  ) {

    return Object.entries(index)
      .sort(
        (a, b) =>
          Number(a[1]) - Number(b[1])
      )
      .map(entry => entry[0]);
  }

  /*
     Algunos JSON-stat pueden representar index como array.
  */

  if (Array.isArray(index)) {
    return index.slice();
  }

  /*
     Si no hay index, intentamos usar label.
  */

  const labels =
    category.label || {};

  return Object.keys(labels);
}


function categoryLabel(dimension, code) {

  const labels =
    dimension?.category?.label || {};

  if (
    Object.prototype.hasOwnProperty.call(
      labels,
      code
    )
  ) {
    return labels[code];
  }

  return code;
}


/*
   Convierte el array plano de JSON-stat en:

   [
     {
       "Sector": "...",
       "periodo": "...",
       "__value": 100
     },
     ...
   ]

   No asumimos absolutamente nada sobre las variables.
*/

function jsonStatToRows(json) {

  const dataset = getDataset(json);

  if (!dataset) {
    throw new Error(
      'La respuesta no contiene una estructura JSON-stat reconocible.'
    );
  }

  const dimensions =
    Array.isArray(dataset.id)
      ? dataset.id
      : [];

  const sizes =
    Array.isArray(dataset.size)
      ? dataset.size
      : [];

  const values =
    Array.isArray(dataset.value)
      ? dataset.value
      : [];

  if (!dimensions.length) {
    throw new Error(
      'El JSON-stat no contiene dimensiones.'
    );
  }

  if (!sizes.length) {
    throw new Error(
      'El JSON-stat no contiene "size".'
    );
  }

  const dimensionData =
    dimensions.map(id => {

      const dimension =
        dataset.dimension?.[id];

      const codes =
        orderedCategoryCodes(dimension);

      return {
        id,
        dimension,
        codes,
        labels: codes.map(
          code =>
            categoryLabel(
              dimension,
              code
            )
        )
      };
    });


  const rows = [];

  /*
     JSON-stat usa un array plano.
     La última dimensión cambia más rápidamente.

     Ejemplo:

     size [2, 3]

     A1
     A2
     A3
     B1
     B2
     B3
  */

  function walk(
    dimensionIndex,
    coordinates,
    flatIndex
  ) {

    if (
      dimensionIndex ===
      dimensionData.length
    ) {

      const row = {};

      dimensionData.forEach(
        (dimension, i) => {

          const code =
            dimension.codes[
              coordinates[i]
            ];

          row[dimension.id] =
            categoryLabel(
              dimension.dimension,
              code
            );

          row[`__code_${dimension.id}`] =
            code;
        }
      );

      row.__value =
        values[flatIndex] ?? null;

      rows.push(row);

      return;
    }

    const size =
      sizes[dimensionIndex];

    for (
      let i = 0;
      i < size;
      i++
    ) {

      /*
         Factor de salto para calcular
         la posición del array plano.
      */

      let multiplier = 1;

      for (
        let j = dimensionIndex + 1;
        j < sizes.length;
        j++
      ) {
        multiplier *= sizes[j];
      }

      const nextIndex =
        flatIndex +
        i * multiplier;

      walk(
        dimensionIndex + 1,
        [...coordinates, i],
        nextIndex
      );
    }
  }

  walk(
    0,
    [],
    0
  );

  return {
    dataset,
    dimensions,
    sizes,
    values,
    dimensionData,
    rows
  };
}


/* ============================================================
   METADATOS → SELECCIONES INICIALES
   ============================================================ */

function createInitialSelections(meta) {

  const selections = {};

  const variables =
    Array.isArray(meta?.variables)
      ? meta.variables
      : [];

  variables.forEach(variable => {

    const values =
      Array.isArray(variable.values)
        ? variable.values
        : [];

    if (!values.length) {
      selections[variable.code] = [];
      return;
    }

    /*
       IMPORTANTE:

       Para una variable temporal queremos el último
       periodo disponible, no el primero.

       Eustat puede devolver:

       2010, 2011, ..., 2025

       y también puede devolver otros formatos.

       El metadata nos dice si es temporal mediante:

       "time": true
    */

    if (isTimeVariable(variable)) {

      selections[variable.code] = [
        values[values.length - 1]
      ];

    } else {

      /*
         Para las demás variables mantenemos el
         primer valor, que suele ser Total / CAE /
         Índice general, etc., pero SIN asumir que
         ese código significa algo concreto.
      */

      selections[variable.code] = [
        values[0]
      ];
    }
  });

  return selections;
}


/* ============================================================
   CONSTRUIR QUERY
   ============================================================ */

function buildQuery(meta) {

  return (meta.variables || [])
    .filter(variable =>
      Array.isArray(variable.values) &&
      variable.values.length
    )
    .map(variable => {

      const selected =
        state.selections[
          variable.code
        ] || [];

      return {
        code: variable.code,

        selection: {
          filter: 'item',
          values: selected
        }
      };
    });
}


/* ============================================================
   ORDEN DE PERIODOS
   ============================================================ */

function orderedVariableValues(variable) {

  const values =
    Array.isArray(variable.values)
      ? variable.values.slice()
      : [];

  if (!isTimeVariable(variable)) {
    return values;
  }

  /*
     Para periodo queremos:

     2025
     2024
     2023
     ...
     2010

     No intentamos convertir a número porque
     puede haber periodos como:

     2026-01
     2025-4
     2024T1

     La prioridad es respetar el orden
     que entrega Eustat y mostrarlo invertido.
  */

  return values.reverse();
}


/* ============================================================
   RENDER DE FILTROS
   ============================================================ */

function renderFilters() {

  const container =
    document.querySelector(
      '#filters'
    );

  if (!container) return;

  container.innerHTML =
    (state.meta.variables || [])
      .map(
        variable =>
          renderVariable(variable)
      )
      .join('');

  attachFilterEvents();
}


function renderVariable(variable) {

  const code =
    variable.code;

  const values =
    orderedVariableValues(variable);

  const selected =
    state.selections[code] || [];

  const count =
    selected.length;

  const total =
    values.length;

  const safeId =
    'var-' +
    btoa(
      unescape(
        encodeURIComponent(code)
      )
    )
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 30);


  return `
    <section
      class="filter-card"
      data-variable="${esc(code)}"
    >

      <div class="filter-card-header">

        <div>
          <h2>
            ${esc(variable.text || code)}
          </h2>

          <span class="selection-count">
            ${count} de ${total} seleccionados
          </span>
        </div>

      </div>


      <div class="filter-actions">

        <button
          type="button"
          class="filter-action"
          data-action="all"
          data-code="${esc(code)}"
        >
          Todos
        </button>

        <button
          type="button"
          class="filter-action"
          data-action="none"
          data-code="${esc(code)}"
        >
          Ninguno
        </button>

      </div>


      ${
        values.length > 12
          ? `
            <input
              class="filter-search"
              type="search"
              placeholder="Buscar..."
              data-search="${esc(code)}"
              autocomplete="off"
            >
          `
          : ''
      }


      <div
        class="filter-options"
        id="${safeId}"
      >

        ${values
          .map(
            value => {

              const checked =
                selected.includes(
                  value
                );

              const label =
                variable.valueTexts?.[
                  variable.values.indexOf(
                    value
                  )
                ] ?? value;

              return `
                <label
                  class="filter-option"
                  data-option
                  data-label="${esc(
                    String(label)
                  ).toLocaleLowerCase('es')}"
                >

                  <input
                    type="checkbox"
                    class="filter-checkbox"
                    data-variable="${esc(code)}"
                    value="${esc(value)}"
                    ${checked ? 'checked' : ''}
                  >

                  <span class="checkbox-box"></span>

                  <span class="filter-label">
                    ${esc(label)}
                  </span>

                </label>
              `;
            }
          )
          .join('')}

      </div>

    </section>
  `;
}


/* ============================================================
   EVENTOS DE FILTROS
   ============================================================ */

function attachFilterEvents() {

  document
    .querySelectorAll(
      '.filter-checkbox'
    )
    .forEach(input => {

      input.addEventListener(
        'change',
        () => {

          const code =
            input.dataset.variable;

          const checked =
            [
              ...document.querySelectorAll(
                `.filter-checkbox[data-variable="${CSS.escape(code)}"]:checked`
              )
            ].map(
              element =>
                element.value
            );

          state.selections[code] =
            checked;

          updateSelectionCount(code);

        }
      );
    });


  document
    .querySelectorAll(
      '[data-action]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const code =
            button.dataset.code;

          const action =
            button.dataset.action;

          const variable =
            state.meta.variables.find(
              v => v.code === code
            );

          if (!variable) return;

          if (action === 'all') {

            state.selections[code] =
              variable.values.slice();

          }

          if (action === 'none') {

            state.selections[code] = [];
          }

          renderFilters();
        }
      );
    });


  document
    .querySelectorAll(
      '.filter-search'
    )
    .forEach(input => {

      input.addEventListener(
        'input',
        () => {

          const term =
            input.value
              .trim()
              .toLocaleLowerCase('es');

          const code =
            input.dataset.search;

          document
            .querySelectorAll(
              `.filter-card[data-variable="${CSS.escape(code)}"] [data-option]`
            )
            .forEach(option => {

              const label =
                option.dataset.label || '';

              option.hidden =
                Boolean(
                  term &&
                  !label.includes(term)
                );
            });
        }
      );
    });
}


function updateSelectionCount(code) {

  const card =
    document.querySelector(
      `.filter-card[data-variable="${CSS.escape(code)}"]`
    );

  if (!card) return;

  const selected =
    state.selections[code] || [];

  const badge =
    card.querySelector(
      '.selection-count'
    );

  const variable =
    state.meta.variables.find(
      v => v.code === code
    );

  if (!badge || !variable) return;

  badge.textContent =
    `${selected.length} de ${variable.values.length} seleccionados`;
}


/* ============================================================
   TABLA
   ============================================================ */

function renderResult(result) {

  const container =
    document.querySelector(
      '#result'
    );

  if (!container) return;

  if (!result) {

    container.innerHTML = `
      <div class="result-empty">
        Pulsa <strong>Mostrar tabla</strong>
        para consultar los datos.
      </div>
    `;

    return;
  }

  const {
    rows,
    dimensions
  } = result;

  if (!rows.length) {

    container.innerHTML = `
      <div class="result-empty">
        La API no devolvió datos para
        la selección realizada.
      </div>
    `;

    return;
  }


  /*
     Para que la tabla sea genérica:

     columnas = dimensiones + Valor

     Esto funciona tanto para:

     Sector + periodo

     como para:

     Sexo + territorio + edad + periodo

     sin conocer previamente la estructura
     de ninguna tabla.
  */

  const headers =
    dimensions
      .map(
        dimension =>
          state.meta.variables.find(
            v => v.code === dimension
          )?.text || dimension
      );


  container.innerHTML = `
    <div class="table-wrapper">

      <table class="data-table">

        <thead>

          <tr>

            ${headers
              .map(
                header =>
                  `<th>${esc(header)}</th>`
              )
              .join('')}

            <th>Valor</th>

          </tr>

        </thead>


        <tbody>

          ${rows
            .map(
              row => `

                <tr>

                  ${dimensions
                    .map(
                      dimension =>
                        `<td>${esc(
                          row[dimension]
                        )}</td>`
                    )
                    .join('')}

                  <td class="value-cell">
                    ${formatValue(
                      row.__value
                    )}
                  </td>

                </tr>

              `
            )
            .join('')}

        </tbody>

      </table>

    </div>
  `;
}


function formatValue(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '…';
  }

  if (
    typeof value === 'number'
  ) {

    return value.toLocaleString(
      'es-ES',
      {
        maximumFractionDigits: 10
      }
    );
  }

  return esc(value);
}


/* ============================================================
   CONSULTAR
   ============================================================ */

async function runQuery() {

  const result =
    document.querySelector(
      '#result'
    );

  const errorBox =
    document.querySelector(
      '#error'
    );

  const rawBox =
    document.querySelector(
      '#raw-response'
    );

  if (!result) return;

  state.loading = true;
  state.error = null;

  if (errorBox) {
    errorBox.innerHTML = '';
    errorBox.hidden = true;
  }

  if (rawBox) {
    rawBox.innerHTML = '';
    rawBox.hidden = true;
  }

  result.innerHTML = `
    <div class="loading">
      Consultando Eustat…
    </div>
  `;


  const query =
    buildQuery(state.meta);

  state.query = {
    query,
    response: {
      format: 'json-stat'
    }
  };


  try {

    const json =
      await apiData(
        state.table.id,
        query
      );

    /*
       Guardamos EXACTAMENTE la respuesta
       recibida de Eustat para poder inspeccionarla.
    */

    state.rawResponse =
      json;

    const parsed =
      jsonStatToRows(json);

    state.result =
      parsed;

    renderResult(parsed);

    renderQuery();

    if (rawBox) {
      rawBox.innerHTML =
        `<pre>${esc(
          JSON.stringify(
            json,
            null,
            2
          )
        )}</pre>`;

      rawBox.hidden = false;
    }

    enableExportButtons();

  } catch (error) {

    state.error =
      error;

    result.innerHTML = '';

    if (errorBox) {

      const details =
        error.raw ||
        error.body ||
        '';

      errorBox.innerHTML = `

        <div class="error-title">
          Error al consultar Eustat
        </div>

        <p>
          ${esc(
            error.message ||
            'Error desconocido'
          )}
        </p>

        ${
          error.status
            ? `
              <p>
                <strong>HTTP:</strong>
                ${esc(error.status)}
              </p>
            `
            : ''
        }

        ${
          details
            ? `
              <details>
                <summary>
                  Respuesta de la API
                </summary>

                <pre>${esc(
                  typeof details === 'string'
                    ? details
                    : JSON.stringify(
                        details,
                        null,
                        2
                      )
                )}</pre>

              </details>
            `
            : ''
        }

      `;

      errorBox.hidden = false;
    }

    renderQuery();
  }

  state.loading = false;
}


/* ============================================================
   MOSTRAR QUERY
   ============================================================ */

function renderQuery() {

  const box =
    document.querySelector(
      '#query-sent'
    );

  if (!box || !state.query) {
    return;
  }

  box.innerHTML = `
    <details>

      <summary>
        Consulta enviada
      </summary>

      <pre>${esc(
        JSON.stringify(
          state.query,
          null,
          2
        )
      )}</pre>

    </details>
  `;
}


/* ============================================================
   EXPORTAR CSV
   ============================================================ */

function exportCSV() {

  if (
    !state.result ||
    !state.result.rows.length
  ) {
    return;
  }

  const {
    rows,
    dimensions
  } = state.result;

  const headers = [
    ...dimensions,
    'Valor'
  ];

  const lines = [
    headers
      .map(csvEscape)
      .join(';')
  ];


  rows.forEach(row => {

    lines.push(
      [
        ...dimensions.map(
          d => row[d]
        ),
        row.__value
      ]
        .map(csvEscape)
        .join(';')
    );
  });


  const blob =
    new Blob(
      [
        '\uFEFF' +
        lines.join('\n')
      ],
      {
        type:
          'text/csv;charset=utf-8'
      }
    );


  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement('a');

  link.href = url;

  link.download =
    `${state.table.id
      .replace(/\.px$/i, '')
    }.csv`;

  link.click();

  URL.revokeObjectURL(url);
}


function csvEscape(value) {

  const text =
    String(value ?? '');

  return `"${text
    .replace(/"/g, '""')}"`;
}


/* ============================================================
   COPIAR QUERY
   ============================================================ */

async function copyQuery() {

  if (!state.query) return;

  const text =
    JSON.stringify(
      state.query,
      null,
      2
    );

  try {

    await navigator.clipboard.writeText(
      text
    );

    const button =
      document.querySelector(
        '#copy-query'
      );

    if (button) {

      const original =
        button.textContent;

      button.textContent =
        'Copiado ✓';

      setTimeout(
        () => {
          button.textContent =
            original;
        },
        1500
      );
    }

  } catch {

    window.prompt(
      'Copia la consulta:',
      text
    );
  }
}


/* ============================================================
   BOTONES DE RESULTADOS
   ============================================================ */

function enableExportButtons() {

  const csv =
    document.querySelector(
      '#download-csv'
    );

  if (csv) {
    csv.disabled =
      !state.result;
  }
}


/* ============================================================
   PÁGINA DE TABLA
   ============================================================ */

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
    meta: null,
    selections: {},
    result: null,
    query: null,
    loading: true,
    error: null
  };


  renderTableShell();


  try {

    /*
       PRIMERO:

       GET metadata.

       Nunca inventamos códigos, categorías
       ni nombres de variables.
    */

    state.meta =
      await apiMeta(id);

    /*
       Después construimos la selección
       inicial a partir del metadata real.
    */

    state.selections =
      createInitialSelections(
        state.meta
      );

    renderFilters();

    renderQuery();

    await runQuery();

  } catch (error) {

    const errorBox =
      document.querySelector(
        '#error'
      );

    if (errorBox) {

      errorBox.innerHTML = `
        <div class="error-title">
          Error al obtener los metadatos
        </div>

        <p>
          ${esc(
            error.message
          )}
        </p>
      `;

      errorBox.hidden = false;
    }
  }

  state.loading = false;
}


/* ============================================================
   ESTRUCTURA DE PÁGINA DE TABLA
   ============================================================ */

function renderTableShell() {

  const title =
    state.table.title ||
    state.table.text ||
    state.table.id;


  app.innerHTML = `

    <main class="table-page">

      <div class="table-page-inner">

        <nav class="breadcrumbs">

          <a href="#/">
            Tablas
          </a>

          <span>›</span>

          <span>
            ${esc(title)}
          </span>

        </nav>


        <div class="table-heading">

          <h1>
            ${esc(title)}
          </h1>

          ${
            state.table.updated
              ? `
                <div class="updated">
                  Actualizada:
                  ${esc(
                    formatDate(
                      state.table.updated
                    )
                  )}
                </div>
              `
              : ''
          }

        </div>


        <div class="api-info">
          ⓘ Consulta datos directamente
          desde la API pública de Eustat.
        </div>


        <div class="table-layout">


          <!-- ================================================
               SIDEBAR
               ================================================ -->

          <aside class="filters-panel">

            <div class="filters-title">
              <h2>
                Seleccionar datos
              </h2>
            </div>

            <div id="filters"></div>

          </aside>


          <!-- ================================================
               CONTENIDO
               ================================================ -->

          <section class="table-content">


            <div class="table-actions">

              <button
                id="show-table"
                class="primary-button"
                type="button"
              >
                Mostrar tabla
              </button>

              <button
                id="download-csv"
                class="secondary-button"
                type="button"
                disabled
              >
                Descargar CSV
              </button>

              <button
                id="copy-query"
                class="secondary-button"
                type="button"
              >
                Copiar consulta API
              </button>

            </div>


            <div
              id="error"
              class="error-box"
              hidden
            ></div>


            <div
              id="result"
              class="result-box"
            >
              <div class="loading">
                Cargando metadatos de Eustat…
              </div>
            </div>


            <div
              id="query-sent"
              class="query-box"
            ></div>


            <details
              id="raw-response"
              class="raw-response"
              hidden
            >
            </details>


          </section>

        </div>

      </div>

    </main>
  `;


  document
    .querySelector(
      '#show-table'
    )
    .addEventListener(
      'click',
      runQuery
    );


  document
    .querySelector(
      '#download-csv'
    )
    .addEventListener(
      'click',
      exportCSV
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


/* ============================================================
   CATÁLOGO
   ============================================================ */

function renderCatalog() {

  app.innerHTML = `

    <main class="catalog">

      <div class="catalog-inner">

        <h1>
          Eustatbank
        </h1>

        <p class="catalog-intro">
          Explora las tablas estadísticas
          de Eustat.
        </p>


        <div class="search">

          <input
            id="q"
            type="search"
            placeholder="Buscar por título, operación, variable o palabra clave…"
            autocomplete="off"
          >

        </div>


        <div class="catalog-grid">

          <aside class="catalog-filters">

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


          <section class="catalog-results">

            <div class="results-head">

              <strong id="count">
                ${catalog.length.toLocaleString(
                  'es-ES'
                )}
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
    document.querySelector(
      '#q'
    );


  search.addEventListener(
    'input',
    () =>
      paintCards(
        search.value
      )
  );


  paintCards('');
}


/* ============================================================
   TARJETAS DEL CATÁLOGO
   ============================================================ */

function paintCards(term) {

  const normalized =
    term
      .trim()
      .toLocaleLowerCase('es');


  /*
     MUY IMPORTANTE:

     Hacemos una copia antes de ordenar.

     Así no modificamos accidentalmente
     el catálogo original.
  */

  const rows =
    catalog
      .filter(item => {

        if (!normalized) {
          return true;
        }

        const searchable =
          [
            item.title,
            item.text,
            item.id,
            item.search_text,
            item.operacion_titulo,
            item.frecuencia
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('es');

        return searchable.includes(
          normalized
        );
      })
      .slice()
      .sort(
        (a, b) =>
          parseDate(b.updated) -
          parseDate(a.updated)
      );


  const count =
    document.querySelector(
      '#count'
    );

  if (count) {

    count.textContent =
      `${rows.length.toLocaleString(
        'es-ES'
      )} tablas`;
  }


  const cards =
    document.querySelector(
      '#cards'
    );

  if (!cards) return;


  cards.innerHTML =
    rows
      .slice(0, 100)
      .map(item => {

        const title =
          item.title ||
          item.text ||
          item.id;


        const variables =
          Array.isArray(
            item.variables
          )
            ? item.variables
            : [];


        return `

          <article
            class="table-card"
          >

            <h2>
              ${esc(title)}
            </h2>


            <div class="table-id">
              ${esc(item.id)}
            </div>


            ${
              item.updated
                ? `
                  <div class="table-updated">
                    Actualizada:
                    ${esc(
                      formatDate(
                        item.updated
                      )
                    )}
                  </div>
                `
                : ''
            }


            ${
              item.first_period ||
              item.last_period
                ? `
                  <div class="table-period">
                    ${esc(
                      item.first_period || ''
                    )}
                    ${
                      item.last_period
                        ? ` — ${esc(
                            item.last_period
                          )}`
                        : ''
                    }
                  </div>
                `
                : ''
            }


            <div class="tags">

              ${
                item.operacion_titulo
                  ? `
                    <span class="tag">
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
                    <span class="tag">
                      ${esc(
                        item.frecuencia
                      )}
                    </span>
                  `
                  : ''
              }


              ${variables
                .slice(0, 5)
                .map(
                  variable =>
                    `<span class="tag">
                      ${esc(
                        variable.text ||
                        variable
                      )}
                    </span>`
                )
                .join('')}

            </div>


            <a
              class="open"
              href="#/table/${encodeURIComponent(
                item.id
              )}"
            >
              Abrir tabla →
            </a>

          </article>

        `;
      })
      .join('');


  if (!cards.innerHTML) {

    cards.innerHTML = `
      <div class="empty">
        No se encontraron tablas.
      </div>
    `;
  }
}


/* ============================================================
   ROUTING
   ============================================================ */

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


/* ============================================================
   INICIO
   ============================================================ */

async function start() {

  try {

    await loadCatalog();

    route();

  } catch (error) {

    app.innerHTML = `

      <main class="catalog">

        <div class="catalog-inner">

          <div class="error-box">

            <div class="error-title">
              No se pudo cargar Eustatbank
            </div>

            <p>
              ${esc(
                error.message
              )}
            </p>

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


start();
