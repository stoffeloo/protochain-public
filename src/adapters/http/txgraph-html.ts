import type { Block } from "../../core/types";

export function renderTxGraphHtml(
  identifier: string,
  txGraph: Block["txGraph"]
): string {
  // Prevent breaking out of <script> tag
  const graphJson = JSON.stringify(txGraph).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Tx Graph - block ${identifier}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; }
    header { padding: 12px 16px; border-bottom: 1px solid #ddd; }
    #graph { width: 100vw; height: calc(100vh - 58px); }
    .meta { color: #666; font-size: 12px; margin-top: 4px; }
  </style>

  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
</head>
<body>
  <header>
    <div><b>Transaction Graph</b> — block <code>${identifier}</code></div>
  </header>

  <div id="graph"></div>

  <script id="txgraph-data" type="application/json">${graphJson}</script>

  <script>
    function main() {
      const el = document.getElementById('txgraph-data');
      const g = JSON.parse(el.textContent);

      const nodes = Object.entries(g.txs).map(([id, node]) => {
        const tx = node.tx;
        const isCall = tx.kind === 'call';
        const method = isCall ? (tx.data?.method ?? '') : '';

        const label =
          (tx.kind ? tx.kind : 'tx') +
          (isCall && method ? '\\n' + method : '') +
          '\\n' +
          id.slice(0, 10) + '…';

        const title =
          'id: ' + id + '\\n' +
          'kind: ' + (tx.kind ?? '') + '\\n' +
          (isCall ? ('method: ' + (method || '(missing)') + '\\n') : '') +
          'from: ' + (tx.from ?? '') + '\\n' +
          'to: ' + (tx.to ?? '') + '\\n' +
          'value: ' + (tx.value ?? tx.amount ?? '');

        return { id, label, title, shape: 'box' };
      });

      const edges = (g.edges || []).map(e => ({
        from: e.from,
        to: e.to,
        arrows: 'to'
      }));

      const container = document.getElementById('graph');
      const data = {
        nodes: new vis.DataSet(nodes),
        edges: new vis.DataSet(edges)
      };

      const options = {
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'LR',
            sortMethod: 'directed'
          }
        },
        physics: false,
        interaction: { hover: true }
      };

      new vis.Network(container, data, options);
    }

    try { main(); }
    catch (err) {
      document.body.innerHTML =
        '<pre style="padding:16px">' +
        String(err?.stack || err) +
        '</pre>';
    }
  </script>
</body>
</html>`;
}