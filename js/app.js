
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

const esc = (s) =>
  String(s ?? '').replace(/[&<>\"]/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[m]));

function parseDate(value) {
  if (!value) return 0;

  const d = new Date(value);

  if (!Number.isNaN(d.getTime())) {
    return d.getTime();
  }

  return 0;
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


/* =========================================================
   CARGA DEL CATÁLOGO
========================================================= */

async function loadCatalog() {
  const response = await fetch(DATA);

  if (!response.ok) {
    throw new Error(`No se pudo cargar el catálogo (${response.status})`);
  }

  const json = await response.json();

  catalog = Array.isArray(json.data) ? json.data : [];

  /*
   * Ordenamos aquí también, para que el catálogo ya esté
   * preparado correctamente desde el principio.
   */
  catalog.sort((a, b) => {
    return parseDate(b.updated) - parseDate(a.updated);
  });
}


/* =========================================================
   API EUSTAT
========================================================= */

async function apiMeta(id) {
  const response = await fetch(
    `${API}/${encodeURIComponent(id)}`,
    {
      headers: {
        'Accept': 'application/json'
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `No se pudieron obtener los metadatos (${response.status}). ${text.slice(0, 500)}`
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


async function apiData(id, query) {
  const body = {
    ...query,
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
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `La consulta ha fallado (HTTP ${response.status}). ${text.slice(0, 800)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Eustat respondió algo que no es JSON válido: ${text.slice(0, 800)}`
    );
  }
}


/* =========================================================
   JSON-STAT 1.2
========================================================= */

/*
 * Eustat devuelve:

 {
   "dataset": {
      "dimension": {...},
      "id": [...],
      "size": [...],
      "value": [...]
   }
 }

 Por tanto primero tenemos que entrar en dataset.
 */

function unwrapJsonStat(raw) {
  if (raw && raw.dataset) {
    return raw.dataset;
  }

  return raw;
}


/*
 * Obtiene las categorías de una dimensión respetando
 * category.index de JSON-stat.
 */
function getDimensionCategories(dimension) {
  if (!dimension || !dimension.category) {
    return [];
  }

  const category = dimension.category;

  const index = category.index || {};
  const labels = category.label || {};

  let keys = [];

  if (Array.isArray(index)) {
    keys = [...index];
  } else if (
    index &&
    typeof index === 'object' &&
    Object.keys(index).length
  ) {
    keys = Object.keys(index).sort(
      (a, b) => Number(index[a]) - Number(index[b])
    );
  } else {
    keys = Object.keys(labels);
  }

  return keys.map(key => ({
    code: key,
    label: labels[key] ?? key
  }));
}


/*
 * Convierte JSON-stat 1.2 en una estructura sencilla
 * que podemos utilizar para pintar la tabla.
 */
function normalizeJsonStat(raw) {
  const j = unwrapJsonStat(raw);

  if (!j || typeof j !== 'object') {
    return null;
  }

  if (!j.dimension) {
    return null;
  }

  const ids = Array.isArray(j.id)
    ? j.id
    : Object.keys(j.dimension);

  const dimensions = ids.map(id => {
    const dimension = j.dimension[id];

    const categories = getDimensionCategories(dimension);

    return {
      id,
      label: dimension?.label || id,
      categories
    };
  });

  const sizes = Array.isArray(j.size)
    ? j.size
    : dimensions.map(d => d.categories.length);

  return {
    raw: j,
    ids,
    sizes,
    dimensions,
    values: j.value
  };
}


/* =========================================================
   VARIABLES / PERIODOS
========================================================= */

function isTimeVariable(variable) {
  if (!variable) return false;

  if (variable.time === true) {
    return true;
  }

  const code = String(variable.code || '').toLowerCase();
  const text = String(variable.text || '').toLowerCase();

  return (
    code === 'periodo' ||
    code === 'period' ||
    code.includes('period') ||
    text === 'periodo' ||
    text === 'período'
  );
}


/*
 * Devuelve los valores de una variable.
 *
 * Para periodo:
 *     2025
 *     2024
 *     2023
 *     ...
 *
 * Para el resto mantiene el orden de Eustat.
 */
function getVariableValues(variable) {
  const values = variable.values || [];
  const texts = variable.valueTexts || [];

  const items = values.map((code, index) => ({
    code,
    text: texts[index] ?? code,
    originalIndex: index
  }));

  if (isTimeVariable(variable)) {
    items.sort((a, b) => {
      return String(b.code).localeCompare(
        String(a.code),
        'es',
        {
          numeric: true,
          sensitivity: 'base'
        }
      );
    });
  }

  return items;
}


/*
 * Inicialización:
 *
 * - Variables normales: primer valor.
 * - Periodo: último periodo disponible.
 *
 * Como getVariableValues() ordena periodo de mayor a menor,
 * el primer elemento es el más reciente.
 */
function initSelections() {
  state.selections = {};

  for (const variable of state.meta.variables || []) {
    const values = getVariableValues(variable);

    if (!values.length) {
      state.selections[variable.code] = [];
      continue;
    }

    state.selections[variable.code] = [
      values[0].code
    ];
  }
}


/* =========================================================
   ROUTER
========================================================= */

function route() {
  const hash = location.hash || '#/';

  const match = hash.match(/^#\/table\/(.+)$/);

  if (match) {
    openTable(decodeURIComponent(match[1]));
    return;
  }

  renderCatalog();
}


/* =========================================================
   TABLA
========================================================= */

async function openTable(id) {
  const table = catalog.find(x => x.id === id);

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

  renderTableShell();

  try {
    state.meta = await apiMeta(id);

    initSelections();

    renderTable();

  } catch (error) {

    app.innerHTML = `
      <main class="catalog">
        <div class="catalog-inner">
          <div class="error">
            ${esc(error.message)}
          </div>
        </div>
      </main>
    `;
  }
}


/* =========================================================
   ESTRUCTURA DE LA PÁGINA DE TABLA
========================================================= */

function renderTableShell() {

  app.innerHTML = `
    <div class="shell">

      <aside class="rail">

        <button class="active">
          <span class="icon">☷</span>
          Filter
        </button>

        <button>
          <span class="icon">▥</span>
          Display
        </button>

        <button>
          <span class="icon">↕</span>
          Edit
        </button>

        <button>
          <span class="icon">⇩</span>
          Save
        </button>

        <button>
          <span class="icon">?</span>
          Help
        </button>

      </aside>


      <aside class="filter-pane" id="filters">

        <div class="filter-head">
          <h2>Seleccionar datos</h2>
        </div>

      </aside>


      <main class="main" id="tablemain"></main>

    </div>
  `;
}


/* =========================================================
   RENDER TABLA
========================================================= */

function renderTable() {

  const meta = state.meta;

  document.querySelector('#filters').innerHTML = `
    <div class="filter-head">
      <h2>Seleccionar datos</h2>
      <button onclick="location.hash='#/'">
        Volver
      </button>
    </div>

    ${(meta.variables || [])
      .map(variable => filterCard(variable))
      .join('')
    }
  `;


  document.querySelector('#tablemain').innerHTML = `

    <div class="notice">
      ⓘ Consulta datos directamente desde la API pública de Eustat.
    </div>

    <div class="breadcrumbs">
      <a href="#/">Tablas</a>
     　›　
      ${esc(meta.title || state.table.title)}
    </div>

    <section class="hero">

      <h1>
        ${esc(state.table.title || meta.title)}
      </h1>

      <div class="meta">

        <span>
          Actualizada:
          ${esc(fmtDate(state.table.updated))}
        </span>

      </div>

    </section>


    <div class="toolbar">

      <button onclick="runQuery()">
        Mostrar tabla
      </button>

      <button onclick="download('csv')">
        Descargar CSV
      </button>

      <button onclick="download('xlsx')">
        Excel
      </button>

      <button onclick="copyQuery()">
        Copiar consulta API
      </button>

    </div>


    <div id="result">

      <div class="empty">
        Selecciona los datos y pulsa
        <strong>Mostrar tabla</strong>.
      </div>

    </div>
  `;
}


/* =========================================================
   TARJETA DE FILTRO
========================================================= */

function filterCard(variable) {

  const values = getVariableValues(variable);

  const selected =
    state.selections[variable.code] || [];


  return `
    <section class="card">

      <h3>
        ${esc(variable.text || variable.code)}
      </h3>

      <span class="pill">
        ${selected.length} de ${values.length} seleccionados
      </span>


      <div class="selection">

        <div class="select-actions">

          <button onclick='selectAll(${JSON.stringify(variable.code)})'>
            Todos
          </button>

          <button onclick='clearAll(${JSON.stringify(variable.code)})'>
            Ninguno
          </button>

        </div>


        <div class="value-list">

          ${values.map(item => `

            <label class="value-row">

              <input
                type="checkbox"
                ${selected.includes(item.code) ? 'checked' : ''}
                onchange='toggleValue(
                  ${JSON.stringify(variable.code)},
                  ${JSON.stringify(item.code)},
                  this.checked
                )'
              >

              <span>
                ${esc(item.text)}
              </span>

            </label>

          `).join('')}

        </div>

      </div>

    </section>
  `;
}


/* =========================================================
   SELECCIONES
========================================================= */

function toggleValue(code, value, checked) {

  state.selections[code] =
    state.selections[code] || [];


  if (
    checked &&
    !state.selections[code].includes(value)
  ) {
    state.selections[code].push(value);
  }


  if (!checked) {

    state.selections[code] =
      state.selections[code]
        .filter(x => x !== value);

  }


  renderFiltersOnly();
}


function renderFiltersOnly() {

  document.querySelector('#filters').innerHTML = `

    <div class="filter-head">
      <h2>Seleccionar datos</h2>

      <button onclick="location.hash='#/'">
        Volver
      </button>
    </div>

    ${(state.meta.variables || [])
      .map(variable => filterCard(variable))
      .join('')
    }
  `;
}


function selectAll(code) {

  const variable =
    state.meta.variables.find(
      x => x.code === code
    );

  if (!variable) return;

  const values =
    getVariableValues(variable);

  state.selections[code] =
    values.map(x => x.code);

  renderFiltersOnly();
}


function clearAll(code) {

  state.selections[code] = [];

  renderFiltersOnly();
}


/* =========================================================
   QUERY
========================================================= */

function buildQuery() {

  return {

    query:
      (state.meta.variables || [])
        .filter(variable =>
          state.selections[variable.code]?.length
        )
        .map(variable => ({

          code: variable.code,

          selection: {
            filter: 'item',
            values:
              state.selections[variable.code]
          }

        }))

  };
}


/* =========================================================
   CONSULTAR DATOS
========================================================= */

async function runQuery() {

  const result =
    document.querySelector('#result');

  result.innerHTML = `
    <div class="loading">
      Consultando Eustat…
    </div>
  `;


  try {

    const query = buildQuery();

    state.result =
      await apiData(
        state.table.id,
        query
      );


    const normalized =
      normalizeJsonStat(state.result);


    if (!normalized) {

      result.innerHTML = `
        <div class="error">

          <strong>
            Eustat no devolvió un JSON-stat reconocible.
          </strong>

          <details>
            <summary>Respuesta recibida</summary>

            <pre>${esc(
              JSON.stringify(
                state.result,
                null,
                2
              )
            )}</pre>

          </details>

        </div>
      `;

      return;
    }


    result.innerHTML =
      renderJsonStat(normalized);


  } catch (error) {

    result.innerHTML = `
      <div class="error">

        <strong>
          Error al consultar Eustat
        </strong>

        <p>
          ${esc(error.message)}
        </p>

        <details>
          <summary>
            Consulta enviada
          </summary>

          <pre>${esc(
            JSON.stringify(
              buildQuery(),
              null,
              2
            )
          )}</pre>

        </details>

      </div>
    `;
  }
}


/* =========================================================
   PINTAR JSON-STAT
========================================================= */

function renderJsonStat(data) {

  const {
    ids,
    sizes,
    dimensions,
    values
  } = data;


  if (
    !ids.length ||
    !dimensions.length
  ) {

    return `
      <div class="empty">
        El JSON-stat no contiene dimensiones.
      </div>
    `;
  }


  /*
   * Generamos todas las coordenadas.
   *
   * Ejemplo:
   *
   * dimensión A: 2 valores
   * dimensión B: 3 valores
   *
   * 2 × 3 = 6 celdas
   */

  const rows = [];


  function generateCoordinates(
    dimension,
    prefix = []
  ) {

    if (dimension === ids.length) {

      rows.push(prefix);

      return;
    }


    for (
      let i = 0;
      i < sizes[dimension];
      i++
    ) {

      generateCoordinates(
        dimension + 1,
        [...prefix, i]
      );
    }
  }


  generateCoordinates(0);


  let html = `

    <div class="table-wrap">

      <table class="result-table">

        <thead>

          <tr>

            ${dimensions.map(d => `
              <th>
                ${esc(d.label)}
              </th>
            `).join('')}

            <th>
              Valor
            </th>

          </tr>

        </thead>

        <tbody>
  `;


  rows
    .slice(0, 5000)
    .forEach(coordinates => {

      /*
       * JSON-stat utiliza orden row-major.
       *
       * Calculamos aquí el índice plano.
       */

      let flatIndex = 0;

      for (
        let i = 0;
        i < coordinates.length;
        i++
      ) {

        flatIndex =
          flatIndex * sizes[i] +
          coordinates[i];
      }


      let value = '';


      if (Array.isArray(values)) {

        value =
          values[flatIndex] ?? '';

      } else if (
        values &&
        typeof values === 'object'
      ) {

        value =
          values[String(flatIndex)] ?? '';

      }


      html += `

        <tr>

          ${coordinates.map((position, i) => {

            const category =
              dimensions[i].categories[position];

            return `
              <td>
                ${esc(category?.label ?? '')}
              </td>
            `;

          }).join('')}


          <td>
            ${esc(value)}
          </td>

        </tr>
      `;
    });


  html += `

        </tbody>

      </table>

    </div>
  `;


  if (rows.length > 5000) {

    html += `
      <p class="status">
        Mostrando 5.000 de
        ${rows.length.toLocaleString('es-ES')}
        celdas.
      </p>
    `;
  }


  return html;
}


/* =========================================================
   DESCARGAS
========================================================= */

async function download(format) {

  if (!state.table) return;


  try {

    const response =
      await fetch(
        `${API}/${encodeURIComponent(state.table.id)}`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/octet-stream'
          },

          body: JSON.stringify({
            ...buildQuery(),

            response: {
              format
            }
          })
        }
      );


    if (!response.ok) {

      const text =
        await response.text();

      throw new Error(
        `Descarga fallida (HTTP ${response.status}). ${text.slice(0, 500)}`
      );
    }


    const blob =
      await response.blob();


    const url =
      URL.createObjectURL(blob);


    const a =
      document.createElement('a');


    a.href = url;


    a.download =
      `${state.table.id}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;


    document.body.appendChild(a);

    a.click();

    a.remove();


    URL.revokeObjectURL(url);

  } catch (error) {

    alert(error.message);

  }
}


/* =========================================================
   COPIAR QUERY
========================================================= */

async function copyQuery() {

  const query =
    JSON.stringify(
      buildQuery(),
      null,
      2
    );


  await navigator.clipboard.writeText(

    `${API}/${state.table.id}

POST body:

${query}`

  );


  alert('Consulta API copiada.');
}


/* =========================================================
   CATÁLOGO
========================================================= */

function renderCatalog() {

  app.innerHTML = `

    <main class="catalog">

      <div class="catalog-inner">

        <h1>
          Eustatbank
        </h1>

        <p>
          Explora las tablas estadísticas de Eustat
          con una experiencia inspirada en PxWeb.
        </p>


        <div class="search">

          <input
            id="q"
            placeholder="Buscar por título, operación, variable o palabra clave…"
            autocomplete="off"
          >

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


  const input =
    document.querySelector('#q');


  input.addEventListener(
    'input',
    () => paintCards(input.value)
  );


  paintCards('');
}


/* =========================================================
   PINTAR TARJETAS DEL CATÁLOGO
========================================================= */

function paintCards(term) {

  const search =
    term
      .trim()
      .toLocaleLowerCase('es');


  const rows =
    catalog

      .filter(table => {

        if (!search) return true;

        const text =
          table.search_text ||
          table.title ||
          '';

        return text
          .toLocaleLowerCase('es')
          .includes(search);
      })

      /*
       * MUY IMPORTANTE:
       *
       * updated viene como:
       *
       * 2026-06-02T09:23:43
       *
       * Por tanto lo convertimos a fecha real.
       */
      .sort((a, b) =>
        parseDate(b.updated) -
        parseDate(a.updated)
      );


  document.querySelector('#count').textContent =
    `${rows.length.toLocaleString('es-ES')} tablas`;


  document.querySelector('#cards').innerHTML =

    rows
      .slice(0, 100)
      .map(table => `

        <article class="table-card">

          <h2>
            ${esc(table.title || table.text)}
          </h2>


          <p>

            <strong>
              ${esc(table.id)}
            </strong>

            ·

            ${esc(table.first_period || '')}

            ${table.last_period
              ? `— ${esc(table.last_period)}`
              : ''
            }

            · Actualizada
            ${esc(fmtDate(table.updated))}

          </p>


          <div class="tags">

            ${
              table.operacion_titulo
                ? `
                  <span class="tag">
                    ${esc(table.operacion_titulo)}
                  </span>
                `
                : ''
            }


            ${
              table.frecuencia
                ? `
                  <span class="tag">
                    ${esc(table.frecuencia)}
                  </span>
                `
                : ''
            }


            ${
              (table.variables || [])
                .slice(0, 5)
                .map(variable => `
                  <span class="tag">
                    ${esc(variable.text || variable)}
                  </span>
                `)
                .join('')
            }

          </div>


          <a
            class="open"
            href="#/table/${encodeURIComponent(table.id)}"
          >
            Abrir tabla →
          </a>

        </article>

      `)
      .join('')

    ||

    `
      <div class="empty">
        No se encontraron tablas.
      </div>
    `;
}


/* =========================================================
   ARRANQUE
========================================================= */

loadCatalog()

  .then(() => {

    route();

  })

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


/* Exponer funciones utilizadas por onclick */
window.runQuery = runQuery;
window.toggleValue = toggleValue;
window.selectAll = selectAll;
window.clearAll = clearAll;
window.download = download;
window.copyQuery = copyQuery;
