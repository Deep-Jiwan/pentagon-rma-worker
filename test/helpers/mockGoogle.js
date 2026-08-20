// A from-scratch, in-memory fake of the two Google APIs the Worker talks to
// (OAuth token exchange + Sheets API) — installed as a global fetch stub, so
// the real src/sheets.js and src/auth.js code paths run unmodified against
// it. This is what lets test/*.test.js call the Worker's actual fetch()
// handler end-to-end without any real credentials or network access.

const SHEET_IDS = { Open: 1, Closed: 2, Master: 3 };
const ID_TO_TAB = { 1: 'Open', 2: 'Closed', 3: 'Master' };

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// initialData: { Open: [[...row], ...], Closed: [...], Master: [...] } —
// row arrays in the same column order as src/constants.js HEADERS (use
// test/helpers/fixtures.js's buildRow() to build them safely by field name).
export function installGoogleMock(initialData = {}) {
  const sheetData = {
    Open: (initialData.Open || []).map((r) => [...r]),
    Closed: (initialData.Closed || []).map((r) => [...r]),
    Master: (initialData.Master || []).map((r) => [...r])
  };

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'fake-access-token', expires_in: 3600 });
    }

    // GET .../spreadsheets/{id}?fields=sheets.properties
    if (/\/spreadsheets\/[^/?]+\?fields=sheets\.properties/.test(url)) {
      return jsonResponse({
        sheets: Object.entries(SHEET_IDS).map(([title, sheetId]) => ({ properties: { title, sheetId } }))
      });
    }

    // GET .../values/{tab}!A2:W
    const getMatch = url.match(/\/values\/([^!]+)!A2:W$/);
    if (getMatch && method === 'GET') {
      const tab = decodeURIComponent(getMatch[1]);
      return jsonResponse({ values: sheetData[tab] || [] });
    }

    // POST .../values/{tab}!A:W:append?...
    const appendMatch = url.match(/\/values\/([^!]+)!A:W:append/);
    if (appendMatch && method === 'POST') {
      const tab = decodeURIComponent(appendMatch[1]);
      const body = JSON.parse(init.body);
      sheetData[tab] = sheetData[tab] || [];
      sheetData[tab].push(body.values[0]);
      return jsonResponse({});
    }

    // PUT .../values/{tab}!A{n}:W{n}?...
    const updateMatch = url.match(/\/values\/([^!]+)!A(\d+):W\d+/);
    if (updateMatch && method === 'PUT') {
      const tab = decodeURIComponent(updateMatch[1]);
      const rowNumber = parseInt(updateMatch[2], 10);
      const body = JSON.parse(init.body);
      sheetData[tab][rowNumber - 2] = body.values[0];
      return jsonResponse({});
    }

    // POST .../spreadsheets/{id}:batchUpdate  (used by deleteRow)
    if (/:batchUpdate/.test(url) && method === 'POST') {
      const body = JSON.parse(init.body);
      const { sheetId, startIndex, endIndex } = body.requests[0].deleteDimension.range;
      const tab = ID_TO_TAB[sheetId];
      // startIndex/endIndex are 0-indexed over the WHOLE sheet (row 0 = the
      // header row), but sheetData[tab] only holds data rows (what A2:W
      // returns) — shift by 1 to land on the right array index.
      sheetData[tab].splice(startIndex - 1, endIndex - startIndex);
      return jsonResponse({});
    }

    throw new Error(`installGoogleMock: unhandled request ${method} ${url}`);
  };

  return {
    sheetData,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}
