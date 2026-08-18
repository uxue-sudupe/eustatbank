
/* =========================================================
   EUSTATBANK
   Aplicación principal

   - Catálogo Eustat
   - Metadatos PX
   - Consultas JSON-stat 1.2
   - Parser dinámico
   - Selección del último período
   - Catálogo ordenado por updated DESC
   ========================================================= */

const API_BASE =
  "https://www.eustat.eus/bankupx/api/v1/es/DB";

const app = document.getElementById("app");

let catalog = [];
let currentTable = null;
let currentMetadata = null;
let currentResult = null;


/* =========================================================
   UTILIDADES
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "numeric",
    year: "numeric"
  }).format(date);
}


function formatValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("es-ES", {
      maximumFractionDigits: 10
    }).format(value);
  }

  return String(value);
}


function isTimeVariable(variable) {
  return Boolean(
    variable.time === true ||
    variable.code?.toLowerCase() === "periodo" ||
    variable.code?.toLowerCase() === "period"
  );
}


/* =========================================================
   FETCH JSON
   ========================================================= */

async function fetchJson(url, options = {}) {

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `La respuesta de Eustat no es JSON válido.\n\nHTTP ${response.status}\n\n${text.slice(0, 2000)}`
    );
  }

  if (!response.ok) {

    const detail =
      typeof data === "string"
        ? data
        : JSON.stringify(data, null, 2);

    throw new Error(
      `Eustat respondió HTTP ${response.status}.\n\n${detail}`
    );
  }

  return data;
}


/* =========================================================
   CATÁLOGO
   ========================================================= */

async function loadCatalog() {

  app.innerHTML = `
    <div class="page">
      <div class="loading">
        Cargando catálogo de Eustat…
      </div>
    </div>
  `;

  catalog = await fetchJson(API_BASE);

  if (!Array.isArray(catalog)) {
    throw new Error(
      "El catálogo recibido de Eustat no tiene el formato esperado."
    );
  }

  /*
   * Eustat devuelve:
   *
   * {
   *   id,
   *   type,
   *   text,
   *   updated
   * }
   *
   * Ordenamos por updated DESC.
   */

  catalog = catalog
    .filter(item => item.type === "t" || !item.type)
    .sort((a, b) => {
      const dateA = new Date(a.updated || 0).getTime();
      const dateB = new Date(b.updated || 0).getTime();

      return dateB - dateA;
    });

  renderHome();
}


/* =========================================================
   HOME
   ========================================================= */

function renderHome() {

  app.innerHTML = `
    <div class="page">

      <section class="hero">

        <h1>Eustatbank</h1>

        <p>
          Explora las tablas estadísticas de Eustat
          directamente desde su API pública.
        </p>

        <div class="search-box">
          <input
            id="catalog-search"
            type="search"
            placeholder="Buscar por título, operación, variable o palabra clave…"
            autocomplete="off"
          >
        </div>

      </section>


      <section class="catalog-layout">

        <aside class="catalog-sidebar">

          <div class="sidebar-item">
            <h2>Contenido</h2>
          </div>

          <div class="sidebar-item">
            <strong>Operación estadística</strong>
          </div>

          <div class="sidebar-item">
            <strong>Frecuencia</strong>
          </div>

          <div class="sidebar-item">
            <strong>Periodo</strong>
          </div>

        </aside>


        <section class="catalog-main">

          <div
            id="catalog-count"
            class="catalog-count"
          ></div>

          <div id="catalog-list"></div>

        </section>

      </section>

    </div>
  `;


  const searchInput =
    document.getElementById("catalog-search");

  searchInput.addEventListener("input", () => {
    renderCatalog(searchInput.value);
  });

  renderCatalog("");
}


function renderCatalog(search = "") {

  const normalizedSearch =
    search.trim().toLocaleLowerCase("es");

  const filtered = catalog.filter(item => {

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      item.id,
      item.text,
      item.updated
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("es");

    return haystack.includes(normalizedSearch);
  });


  document.getElementById("catalog-count").textContent =
    `${filtered.length} ${filtered.length === 1 ? "tabla" : "tablas"}`;


  const list =
    document.getElementById("catalog-list");


  if (filtered.length === 0) {

    list.innerHTML = `
      <div class="message">
        <strong>No se encontraron tablas.</strong>
        Prueba con otra búsqueda.
      </div>
    `;

    return;
  }


  list.innerHTML = filtered
    .map(item => {

      const id = escapeHtml(item.id);
      const title = escapeHtml(item.text);
      const updated = formatDate(item.updated);

      return `
        <article class="table-card">

          <h2>${title}</h2>

          <div class="table-id">
            ${id}
          </div>

          <div class="table-updated">
            Actualizada: ${escapeHtml(updated)}
          </div>

          <a href="#/table/${encodeURIComponent(item.id)}">
            Abrir tabla →
          </a>

        </article>
      `;
    })
    .join("");
}


/* =========================================================
   TABLA
   ========================================================= */

async function openTable(tableId) {

  const item = catalog.find(
    table => table.id === tableId
  );

  currentTable = item || {
    id: tableId,
    text: tableId
  };


  app.innerHTML = `
    <div class="page">

      <div class="loading">
        Cargando metadatos de la tabla…
      </div>

    </div>
  `;


  try {

    /*
     * GET de metadatos.
     *
     * Eustat devuelve:
     *
     * {
     *   title: "...",
     *   variables: [...]
     * }
     */

    currentMetadata =
      await fetchJson(
        `${API_BASE}/${encodeURIComponent(tableId)}`
      );


    if (
      !currentMetadata ||
      !Array.isArray(currentMetadata.variables)
    ) {
      throw new Error(
        "Los metadatos de Eustat no contienen una lista de variables válida."
      );
    }


    renderTablePage();

  } catch (error) {

    renderTableError(error);
  }
}


/* =========================================================
   PÁGINA DE TABLA
   ========================================================= */

function renderTablePage() {

  const title =
    currentMetadata.title ||
    currentTable.text ||
    currentTable.id;


  const updated =
    currentTable.updated;


  app.innerHTML = `
    <div class="page">

      <div class="breadcrumbs">
        <a href="#/">Tablas</a>
        <span>　›　</span>
        ${escapeHtml(title)}
      </div>


      <h1 class="table-page-title">
        ${escapeHtml(title)}
      </h1>


      ${
        updated
          ? `
            <div class="updated-line">
              Actualizada: ${escapeHtml(formatDate(updated))}
            </div>
          `
          : ""
      }


      <div class="api-note">
        ⓘ Consulta datos directamente desde la API pública de Eustat.
      </div>


      <section class="selection-panel">

        <div class="selection-header">

          <h2>Seleccionar datos</h2>

          <button
            id="back-button"
            class="button"
            type="button"
          >
            Volver
          </button>

        </div>


        <div
          id="variables"
          class="variable-grid"
        ></div>

      </section>


      <section>

        <div class="result-actions">

          <button
            id="show-table"
            class="button button-primary"
            type="button"
          >
            Mostrar tabla
          </button>

          <button
            id="download-csv"
            class="button"
            type="button"
            disabled
          >
            Descargar CSV
          </button>

          <button
            id="download-excel"
            class="button"
            type="button"
            disabled
          >
            Excel
          </button>

          <button
            id="copy-api"
            class="button"
            type="button"
            disabled
          >
            Copiar consulta API
          </button>

        </div>


        <div id="result"></div>

      </section>

    </div>
  `;


  document
    .getElementById("back-button")
    .addEventListener("click", () => {
      location.hash = "#/";
    });


  renderVariables();
}


/* =========================================================
   VARIABLES
   ========================================================= */

function renderVariables() {

  const container =
    document.getElementById("variables");


  container.innerHTML =
    currentMetadata.variables
      .map((variable, index) =>
        renderVariable(variable, index)
      )
      .join("");


  currentMetadata.variables.forEach(
    (variable, index) => {

      const variableElement =
        document.querySelector(
          `[data-variable-index="${index}"]`
        );


      const checkboxes =
        variableElement.querySelectorAll(
          'input[type="checkbox"]'
        );


      const count =
        variableElement.querySelector(
          ".variable-count"
        );


      const updateCount = () => {

        const selected =
          [...checkboxes]
            .filter(input => input.checked)
            .length;

        count.textContent =
          `${selected} de ${checkboxes.length} seleccionados`;

      };


      checkboxes.forEach(input => {
        input.addEventListener(
          "change",
          updateCount
        );
      });


      const allButton =
        variableElement.querySelector(
          "[data-action='all']"
        );

      const noneButton =
        variableElement.querySelector(
          "[data-action='none']"
        );


      allButton.addEventListener("click", () => {

        checkboxes.forEach(
          input => {
            input.checked = true;
          }
        );

        updateCount();
      });


      noneButton.addEventListener("click", () => {

        checkboxes.forEach(
          input => {
            input.checked = false;
          }
        );

        updateCount();
      });


      const search =
        variableElement.querySelector(
          ".variable-search"
        );


      search.addEventListener("input", () => {

        const query =
          search.value
            .trim()
            .toLocaleLowerCase("es");


        variableElement
          .querySelectorAll(".option")
          .forEach(option => {

            const text =
              option.textContent
                .toLocaleLowerCase("es");

            option.hidden =
              query && !text.includes(query);
          });
      });
    }
  );
}


/* =========================================================
   VARIABLE INDIVIDUAL
   ========================================================= */

function renderVariable(variable, index) {

  const values =
    Array.isArray(variable.values)
      ? variable.values
      : [];


  const labels =
    Array.isArray(variable.valueTexts)
      ? variable.valueTexts
      : values;


  /*
   * IMPORTANTE:
   *
   * Si es una variable temporal,
   * seleccionamos el ÚLTIMO valor.
   *
   * No asumimos que "_T" significa total.
   * Los códigos son simplemente códigos.
   */

  const time =
    isTimeVariable(variable);


  const defaultIndex =
    values.length > 0
      ? time
        ? values.length - 1
        : 0
      : -1;


  return `
    <section
      class="variable-card"
      data-variable-index="${index}"
    >

      <h3>
        ${escapeHtml(variable.text || variable.code)}
      </h3>


      <div class="variable-count">
        ${defaultIndex >= 0 ? "1" : "0"} de ${values.length} seleccionados
      </div>


      <div class="variable-actions">

        <button
          class="button"
          type="button"
          data-action="all"
        >
          Todos
        </button>

        <button
          class="button"
          type="button"
          data-action="none"
        >
          Ninguno
        </button>

      </div>


      ${
        values.length > 12
          ? `
            <input
              class="variable-search"
              type="search"
              placeholder="Buscar..."
              autocomplete="off"
            >
          `
          : ""
      }


      <div class="options-list">

        ${values
          .map((value, valueIndex) => {

            const checked =
              valueIndex === defaultIndex
                ? "checked"
                : "";


            const label =
              labels[valueIndex] ??
              value;


            return `
              <label class="option">

                <input
                  type="checkbox"
                  value="${escapeHtml(value)}"
                  data-variable-code="${escapeHtml(variable.code)}"
                  ${checked}
                >

                <span class="option-label">
                  ${escapeHtml(label)}
                </span>

              </label>
            `;
          })
          .join("")}

      </div>

    </section>
  `;
}


/* =========================================================
   CONSTRUIR QUERY
   ========================================================= */

function buildQuery() {

  const query = [];


  currentMetadata.variables.forEach(
    (variable, variableIndex) => {

      const variableElement =
        document.querySelector(
          `[data-variable-index="${variableIndex}"]`
        );


      if (!variableElement) {
        return;
      }


      const selected =
        [...variableElement.querySelectorAll(
          'input[type="checkbox"]:checked'
        )]
          .map(input => input.value);


      /*
       * Si no se selecciona nada de una variable,
       * no la incluimos.
       *
       * Esto permite que Eustat aplique su comportamiento
       * por defecto.
       */

      if (selected.length === 0) {
        return;
      }


      query.push({
        code: variable.code,
        selection: {
          filter: "item",
          values: selected
        }
      });
    }
  );


  return {
    query,
    response: {
      format: "json-stat"
    }
  };
}


/* =========================================================
   CONSULTA API
   ========================================================= */

async function requestData() {

  const query =
    buildQuery();


  const result =
    document.getElementById("result");


  const showButton =
    document.getElementById("show-table");


  showButton.disabled = true;


  result.innerHTML = `
    <div class="loading">
      Consultando datos a Eustat…
    </div>
  `;


  try {

    const response =
      await fetch(
        `${API_BASE}/${encodeURIComponent(currentTable.id)}`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },

          body: JSON.stringify(query)
        }
      );


    const text =
      await response.text();


    let json;


    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `La API no devolvió JSON.\n\nHTTP ${response.status}\n\n${text.slice(0, 3000)}`
      );
    }


    if (!response.ok) {

      throw new Error(
        `La API respondió HTTP ${response.status}.\n\n` +
        JSON.stringify(json, null, 2)
      );
    }


    currentResult =
      parseEustatJsonStat(json);


    renderResult(currentResult);


    document
      .getElementById("download-csv")
      .disabled = false;


    document
      .getElementById("copy-api")
      .disabled = false;


    document
      .getElementById("download-excel")
      .disabled = true;


    /*
     * Guardamos la query para poder copiarla.
     */

    document
      .getElementById("copy-api")
      .dataset.query =
      JSON.stringify(query, null, 2);


  } catch (error) {

    renderQueryError(
      error,
      query
    );

  } finally {

    showButton.disabled = false;
  }
}


/* =========================================================
   PARSER JSON-STAT 1.2
   ========================================================= */

/*
 * Eustat devuelve actualmente una estructura de este estilo:
 *
 * {
 *   "dataset": {
 *
 *     "dimension": {
 *
 *       "Sector": {
 *         "category": {
 *           "index": {...},
 *           "label": {...}
 *         }
 *       },
 *
 *       "periodo": {
 *         "category": {
 *           "index": {...},
 *           "label": {...}
 *         }
 *       }
 *
 *     },
 *
 *     "id": [
 *       "Sector",
 *       "periodo"
 *     ],
 *
 *     "size": [
 *       1,
 *       5
 *     ],
 *
 *     "value": [
 *       100,
 *       104.5,
 *       107.8,
 *       111.1,
 *       115
 *     ]
 *
 *   }
 * }
 *
 *
 * NO hacemos:
 *
 * Object.entries(dataset)
 *
 * porque eso convertiría "id", "size", etc.
 * en falsas columnas.
 *
 *
 * Utilizamos:
 *
 * dataset.id
 * dataset.size
 * dataset.dimension
 * dataset.value
 */


/**
 * Obtiene el objeto dataset tanto si Eustat
 * lo devuelve directamente como si viene
 * dentro de { dataset: ... }.
 */
function getDataset(json) {

  if (
    json &&
    json.dataset &&
    typeof json.dataset === "object"
  ) {
    return json.dataset;
  }


  if (
    json &&
    Array.isArray(json.id) &&
    Array.isArray(json.size)
  ) {
    return json;
  }


  throw new Error(
    "El JSON-stat no contiene un dataset reconocible."
  );
}


/**
 * Convierte category.index a una lista ordenada
 * de códigos.
 *
 * JSON-stat permite que index sea:
 *
 * {
 *   "10": 0,
 *   "20": 1
 * }
 *
 * o una lista.
 */
function getCategoryCodes(category) {

  if (!category) {
    return [];
  }


  const index =
    category.index;


  if (Array.isArray(index)) {
    return index.map(String);
  }


  if (
    index &&
    typeof index === "object"
  ) {

    return Object.entries(index)
      .sort((a, b) => {
        return Number(a[1]) - Number(b[1]);
      })
      .map(([code]) => code);
  }


  /*
   * Si no hay index pero sí label,
   * usamos el orden de label.
   */

  if (
    category.label &&
    typeof category.label === "object"
  ) {

    return Object.keys(category.label);
  }


  return [];
}


/**
 * Obtiene etiqueta descriptiva de una categoría.
 */
function getCategoryLabel(
  category,
  code
) {

  if (
    category &&
    category.label &&
    Object.prototype.hasOwnProperty.call(
      category.label,
      code
    )
  ) {
    return category.label[code];
  }


  return code;
}


/**
 * Producto cartesiano / decodificación
 * del vector "value".
 *
 * En JSON-stat la última dimensión
 * es la que varía más rápidamente.
 */
function decodeJsonStatValues(
  dimensionIds,
  dimensionSizes,
  dimensionInfo,
  values
) {

  const rows = [];


  const totalCells =
    dimensionSizes.reduce(
      (acc, size) => acc * size,
      1
    );


  for (
    let flatIndex = 0;
    flatIndex < totalCells;
    flatIndex++
  ) {

    const row = {};


    let remainder =
      flatIndex;


    /*
     * Recorremos de derecha a izquierda
     * porque la última dimensión cambia
     * más rápidamente.
     */

    for (
      let dimensionIndex =
        dimensionIds.length - 1;

      dimensionIndex >= 0;

      dimensionIndex--
    ) {

      const size =
        dimensionSizes[dimensionIndex];


      const position =
        remainder % size;


      remainder =
        Math.floor(remainder / size);


      const dimensionId =
        dimensionIds[dimensionIndex];


      const dimension =
        dimensionInfo[dimensionId];


      const category =
        dimension?.category;


      const codes =
        getCategoryCodes(category);


      const code =
        codes[position];


      row[dimensionId] = {
        code,
        label: getCategoryLabel(
          category,
          code
        )
      };
    }


    row.__value =
      Array.isArray(values)
        ? values[flatIndex]
        : null;


    rows.push(row);
  }


  return rows;
}


/**
 * Parser principal.
 */
function parseEustatJsonStat(json) {

  const dataset =
    getDataset(json);


  const dimensionIds =
    Array.isArray(dataset.id)
      ? dataset.id
      : [];


  const dimensionSizes =
    Array.isArray(dataset.size)
      ? dataset.size.map(Number)
      : [];


  const dimensionInfo =
    dataset.dimension;


  const values =
    Array.isArray(dataset.value)
      ? dataset.value
      : [];


  if (
    dimensionIds.length === 0 ||
    dimensionSizes.length === 0
  ) {
    throw new Error(
      "El JSON-stat no contiene dimensiones."
    );
  }


  if (
    dimensionIds.length !==
    dimensionSizes.length
  ) {
    throw new Error(
      "JSON-stat inconsistente: id y size no tienen la misma longitud."
    );
  }


  const expectedCells =
    dimensionSizes.reduce(
      (acc, size) => acc * size,
      1
    );


  if (values.length < expectedCells) {

    throw new Error(
      `JSON-stat inconsistente: se esperaban ${expectedCells} valores y se recibieron ${values.length}.`
    );
  }


  const rows =
    decodeJsonStatValues(
      dimensionIds,
      dimensionSizes,
      dimensionInfo,
      values
    );


  return {
    title: dataset.label || currentMetadata?.title || "",
    dimensions: dimensionIds,
    rows
  };
}


/* =========================================================
   RENDER RESULTADO
   ========================================================= */

function renderResult(parsed) {

  const result =
    document.getElementById("result");


  if (!parsed.rows.length) {

    result.innerHTML = `
      <div class="message">
        <strong>La consulta no devuelve datos.</strong>
      </div>
    `;

    return;
  }


  const headers =
    parsed.dimensions;


  const body =
    parsed.rows
      .map(row => {

        const cells =
          headers
            .map(header => `
              <td>
                ${escapeHtml(
                  row[header]?.label ??
                  row[header]?.code ??
                  ""
                )}
              </td>
            `)
            .join("");


        return `
          <tr>
            ${cells}

            <td class="value-cell">
              ${escapeHtml(
                formatValue(row.__value)
              )}
            </td>
          </tr>
        `;
      })
      .join("");


  result.innerHTML = `
    <div class="result-wrapper">

      <table class="data-table">

        <thead>
          <tr>

            ${headers
              .map(header => `
                <th>
                  ${escapeHtml(
                    getMetadataVariableLabel(header)
                  )}
                </th>
              `)
              .join("")}

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


    <details class="api-query">

      <summary>
        Estructura JSON-stat recibida
      </summary>

      <pre>${escapeHtml(
        JSON.stringify(
          parsed,
          null,
          2
        )
      )}</pre>

    </details>
  `;


  /*
   * Ahora sí tenemos datos reales.
   */

  document
    .getElementById("download-csv")
    .disabled = false;
}


/**
 * Busca el texto descriptivo de una variable
 * a partir de su código.
 */
function getMetadataVariableLabel(code) {

  const variable =
    currentMetadata.variables.find(
      variable =>
        variable.code === code
    );


  return (
    variable?.text ||
    variable?.code ||
    code
  );
}


/* =========================================================
   ERRORES
   ========================================================= */

function renderTableError(error) {

  app.innerHTML = `
    <div class="page">

      <div class="breadcrumbs">
        <a href="#/">Tablas</a>
      </div>


      <div class="message message-error">

        <strong>
          No se pudieron cargar los metadatos.
        </strong>

        <pre>${escapeHtml(
          error.message
        )}</pre>

      </div>

    </div>
  `;
}


function renderQueryError(
  error,
  query
) {

  const result =
    document.getElementById("result");


  result.innerHTML = `
    <div class="message message-error">

      <strong>
        Error al consultar Eustat
      </strong>

      <div>
        ${escapeHtml(error.message)}
      </div>


      <details class="api-query">

        <summary>
          Consulta enviada
        </summary>

        <pre>${escapeHtml(
          JSON.stringify(
            query,
            null,
            2
          )
        )}</pre>

      </details>

    </div>
  `;
}


/* =========================================================
   CSV
   ========================================================= */

function createCsv(parsed) {

  const headers = [
    ...parsed.dimensions,
    "Valor"
  ];


  const rows = [
    headers,
    ...parsed.rows.map(row => [
      ...parsed.dimensions.map(
        dimension =>
          row[dimension]?.label ??
          row[dimension]?.code ??
          ""
      ),
      row.__value ?? ""
    ])
  ];


  return rows
    .map(row =>
      row
        .map(cell =>
          `"${String(cell ?? "")
            .replaceAll('"', '""')}"`
        )
        .join(";")
    )
    .join("\r\n");
}


function downloadCsv() {

  if (!currentResult) {
    return;
  }


  const csv =
    createCsv(currentResult);


  const blob =
    new Blob(
      ["\uFEFF" + csv],
      {
        type: "text/csv;charset=utf-8;"
      }
    );


  const url =
    URL.createObjectURL(blob);


  const link =
    document.createElement("a");


  link.href = url;

  link.download =
    `${currentTable.id.replaceAll(".px", "")}.csv`;


  document.body.appendChild(link);

  link.click();

  link.remove();

  URL.revokeObjectURL(url);
}


/* =========================================================
   ROUTER
   ========================================================= */

function handleRoute() {

  const hash =
    location.hash || "#/";


  if (
    hash === "#/" ||
    hash === "#"
  ) {

    if (!catalog.length) {
      loadCatalog().catch(error => {
        renderGlobalError(error);
      });
    } else {
      renderHome();
    }

    return;
  }


  if (hash.startsWith("#/table/")) {

    const encodedId =
      hash.substring("#/table/".length);


    const tableId =
      decodeURIComponent(encodedId);


    openTable(tableId);

    return;
  }


  location.hash = "#/";
}


/* =========================================================
   EVENTOS GLOBALES
   ========================================================= */

document.addEventListener(
  "click",
  event => {

    const showButton =
      event.target.closest("#show-table");


    if (showButton) {
      requestData();
    }


    const csvButton =
      event.target.closest("#download-csv");


    if (csvButton) {
      downloadCsv();
    }


    const copyButton =
      event.target.closest("#copy-api");


    if (copyButton) {

      const query =
        copyButton.dataset.query;


      if (query) {

        navigator.clipboard
          .writeText(query)
          .then(() => {

            const oldText =
              copyButton.textContent;

            copyButton.textContent =
              "¡Copiada!";

            setTimeout(() => {
              copyButton.textContent =
                oldText;
            }, 1500);

          })
          .catch(() => {

            alert(
              "No se pudo copiar automáticamente la consulta."
            );
          });
      }
    }
  }
);


/* =========================================================
   ERROR GLOBAL
   ========================================================= */

function renderGlobalError(error) {

  app.innerHTML = `
    <div class="page">

      <div class="message message-error">

        <strong>
          No se pudo cargar Eustatbank.
        </strong>

        <pre>${escapeHtml(
          error.message
        )}</pre>

      </div>

    </div>
  `;
}


/* =========================================================
   INICIO
   ========================================================= */

window.addEventListener(
  "hashchange",
  handleRoute
);


handleRoute();
