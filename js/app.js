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

const esc = s =>
  String(s ?? '').replace(/[&<>"]/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[m]));

const fmtDate = s =>
  s
    ? new Date(s).toLocaleString('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short'
      })
    : '';

async function loadCatalog() {
  const r = await fetch(DATA);
  const j = await r.json();
  catalog = j.data || [];
}

async function apiMeta(id) {
  const r = await fetch(
    `${API}/${encodeURIComponent(id)}`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!r.ok) {
    throw new Error(
      `No se pudieron obtener los metadatos (${r.status})`
    );
  }

  return r.json();
}

async function apiData(id, query) {
  const r = await fetch(
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

  if (!r.ok) {
    throw new Error(
      `La consulta ha fallado (${r.status})`
    );
  }

  return r.json();
}


/* =========================================================
   PRUEBA DE CORS
   ========================================================= */

async function testApi() {

  const box = document.querySelector('#api-test');

  if (!box) return;

  box.innerHTML = `
    <div class="loading">
      Probando conexión con la API de Eustat…
    </div>
  `;

  const lines = [];

  try {

    /* -----------------------------------------------------
       1. GET del catálogo/API
       ----------------------------------------------------- */

    const t0 = performance.now();

    const r = await fetch(API, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!r.ok) {
      throw new Error(
        `GET catálogo API respondió HTTP ${r.status}`
      );
    }

    await r.json();

    lines.push(
      `GET API: OK (${Math.round(performance.now() - t0)} ms)`
    );


    /* -----------------------------------------------------
       2. GET de metadatos de una tabla
       ----------------------------------------------------- */

    const first =
      catalog.find(x => x.id) || catalog[0];

    if (!first) {
      throw new Error(
        'No se encontró ninguna tabla en index_es.json'
      );
    }

    const t1 = performance.now();

    const mr = await fetch(
      `${API}/${encodeURIComponent(first.id)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!mr.ok) {
      throw new Error(
        `GET metadatos respondió HTTP ${mr.status}`
      );
    }

    const meta = await mr.json();

    lines.push(
      `GET metadatos: OK (${Math.round(performance.now() - t1)} ms)`
    );


    /* -----------------------------------------------------
       3. POST real de datos
       ----------------------------------------------------- */

    const vars = (meta.variables || [])
      .filter(v => v.values?.length)
      .map(v => ({
        code: v.code,
        selection: {
          filter: 'item',
          values: [v.values[0]]
        }
      }));

    const t2 = performance.now();

    const pr = await fetch(
      `${API}/${encodeURIComponent(first.id)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          query: vars,
          response: {
            format: 'json-stat'
          }
        })
      }
    );

    if (!pr.ok) {
      throw new Error(
        `POST datos respondió HTTP ${pr.status}`
      );
    }

    await pr.json();

    lines.push(
      `POST datos: OK (${Math.round(performance.now() - t2)} ms)`
    );


    /* -----------------------------------------------------
       TODO CORRECTO
       ----------------------------------------------------- */

    box.innerHTML = `
      <div class="api-ok">

        <strong>🟢 CORS FUNCIONA</strong>

        <p>
          El navegador puede comunicarse directamente
          con la API de Eustat.
        </p>

        <p>
          <strong>No necesitamos un proxy ni un servidor
          intermedio.</strong>
        </p>

        <ul>
          ${lines.map(x => `<li>${esc(x)}</li>`).join('')}
        </ul>

        <p>
          Tabla utilizada para la prueba:
          <strong>${esc(first.id)}</strong>
        </p>

      </div>
    `;

  } catch (e) {

    box.innerHTML = `
      <div class="api-error">

        <strong>🔴 La conexión directa no funciona</strong>

        <p>
          ${esc(e.message)}
        </p>

        <p>
          Si el navegador muestra un error de CORS
          en la consola, necesitaremos un pequeño proxy.
        </p>

        <ul>
          ${lines.map(x => `<li>${esc(x)}</li>`).join('')}
        </ul>

      </div>
    `;
  }
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


        <!-- PRUEBA CORS -->

        <div class="api-test-area">

          <button
            class="api-test-button"
            onclick="testApi()"
          >
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


  const q = document.querySelector('#q');

  q.addEventListener(
    'input',
    () => paintCards(q.value)
  );

  paintCards('');
}


/* =========================================================
   TARJETAS
   ========================================================= */

function paintCards(term) {

  const t =
    term.trim().toLocaleLowerCase('es');

  const rows = catalog

    .filter(x =>
      !t ||
      (x.search_text ||
       x.title ||
       '')
        .toLocaleLowerCase('es')
        .includes(t)
    )

    .sort((a, b) =>
      String(b.updated)
        .localeCompare(String(a.updated))
    );


  document.querySelector('#count')
    .textContent =
      `${rows.length.toLocaleString('es-ES')} tablas`;


  document.querySelector('#cards')
    .innerHTML = rows
      .slice(0, 100)
      .map(x => `

        <article class="table-card">

          <h2>
            ${esc(x.title || x.text)}
          </h2>

          <p>
            <strong>
              ${esc(x.id)}
            </strong>

            · ${esc(x.first_period || '')}

            ${x.last_period
              ? `— ${esc(x.last_period)}`
              : ''}

            · Actualizada
            ${esc(fmtDate(x.updated))}
          </p>


          <div class="tags">

            ${
              x.operacion_titulo
                ? `<span class="tag">
                    ${esc(x.operacion_titulo)}
                   </span>`
                : ''
            }

            ${
              x.frecuencia
                ? `<span class="tag">
                    ${esc(x.frecuencia)}
                   </span>`
                : ''
            }

            ${(x.variables || [])
              .slice(0, 5)
              .map(v =>
                `<span class="tag">
                  ${esc(v.text || v)}
                 </span>`
              )
              .join('')}

          </div>


          <a
            class="open"
            href="#/table/${encodeURIComponent(x.id)}"
          >
            Abrir tabla →
          </a>

        </article>

      `)
      .join('')

      ||

      '<div class="empty">No se encontraron tablas.</div>';
}


/* =========================================================
   ROUTING
   ========================================================= */

function route() {

  const hash = location.hash || '#/';

  const m =
    hash.match(/^#\/table\/(.+)$/);

  if (m) {

    openTable(
      decodeURIComponent(m[1])
    );

    return;
  }

  renderCatalog();
}


async function openTable(id) {

  const table =
    catalog.find(x => x.id === id);

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

  try {

    state.meta =
      await apiMeta(id);

    alert(
      '🟢 GET de metadatos correcto.\n\n' +
      'La API de Eustat responde desde el navegador.'
    );

  } catch (e) {

    alert(
      '🔴 Error al consultar Eustat:\n\n' +
      e.message
    );
  }
}


loadCatalog()
  .then(() => route())
  .catch(e => {

    app.innerHTML = `
      <main class="catalog">

        <div class="catalog-inner">

          <div class="error">

            No se pudo cargar el catálogo:

            ${esc(e.message)}

          </div>

        </div>

      </main>
    `;
  });


window.addEventListener(
  'hashchange',
  route
);

window.testApi = testApi;
