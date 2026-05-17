import type { Sequence } from '../types';

interface ExportOptions {
  title: string;
  subtitle?: string;
  /** Heure de début au format HH:MM */
  startTime: string;
}

/**
 * Ouvre une page de prévisualisation imprimable dans un nouvel onglet.
 * La page contient deux boutons : « Télécharger en PDF » (via window.print
 * → l'utilisateur choisit Save as PDF) et « Télécharger en Markdown »
 * (Blob download direct).
 *
 * On utilise un Blob URL ouvert via un anchor click au lieu de window.open,
 * pour bypasser les bloqueurs de pop-up : navigateur considère cette ouverture
 * comme une simple navigation utilisateur.
 */
export function printSequenceAsPdf(sequence: Sequence, opts: ExportOptions): void {
  const html = buildPreviewHtml(sequence, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Le navigateur a quelques secondes pour charger le blob avant qu'on le libère
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ----------------------------------------------------------------
   Helpers de formatage
   ---------------------------------------------------------------- */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseStartTime(s: string): { h: number; m: number } {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 10, m: 0 };
  return {
    h: Math.max(0, Math.min(23, parseInt(m[1], 10))),
    m: Math.max(0, Math.min(59, parseInt(m[2], 10))),
  };
}

function addMinutes(baseMin: number, addMin: number): string {
  const total = ((baseMin + addMin) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'sequence';
}

/** Construit le contenu Markdown (utilisé par le bouton de téléchargement dans la page) */
function buildMarkdown(sequence: Sequence, opts: ExportOptions): string {
  const { h, m } = parseStartTime(opts.startTime);
  const startTotalMin = h * 60 + m;

  let cum = 0;
  const rows = sequence.steps.map((step) => {
    const startTime = addMinutes(startTotalMin, cum);
    cum += step.duration < 60 ? 1 : Math.round(step.duration / 60);
    return `| ${startTime} | ${escapeMd(step.name)} | ${formatDurationHuman(step.duration)} |`;
  });
  const endTime = addMinutes(startTotalMin, cum);
  const totalSec = sequence.steps.reduce((s, x) => s + x.duration, 0);
  const totalLabel = formatDurationHuman(totalSec);

  const lines: string[] = [];
  lines.push(`# ${opts.title}`);
  lines.push('');
  if (opts.subtitle) {
    lines.push(`> ${opts.subtitle}`);
    lines.push('');
  }
  lines.push(`**Début** : ${pad2(h)}:${pad2(m)}  `);
  lines.push(`**Fin estimée** : ${endTime}  `);
  lines.push(`**Durée totale** : ${totalLabel}  `);
  lines.push(`**Nombre d'étapes** : ${sequence.steps.length}`);
  lines.push('');
  lines.push('| Heure | Étape | Durée |');
  lines.push('|---|---|---|');
  lines.push(...rows);
  lines.push(`| **${endTime}** | **Fin de séquence** | **Total ${totalLabel}** |`);
  return lines.join('\n');
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/* ----------------------------------------------------------------
   Page de prévisualisation
   ---------------------------------------------------------------- */

function buildPreviewHtml(sequence: Sequence, opts: ExportOptions): string {
  const { h, m } = parseStartTime(opts.startTime);
  const startTotalMin = h * 60 + m;

  let cum = 0;
  const rows = sequence.steps.map((step) => {
    const stepStart = addMinutes(startTotalMin, cum);
    cum += step.duration < 60 ? 1 : Math.round(step.duration / 60);
    return {
      time: stepStart,
      name: escapeHtml(step.name),
      duration: formatDurationHuman(step.duration),
    };
  });
  const endTime = addMinutes(startTotalMin, cum);
  const totalSec = sequence.steps.reduce((s, x) => s + x.duration, 0);
  const totalLabel = formatDurationHuman(totalSec);

  const markdown = buildMarkdown(sequence, opts);
  const slug = slugify(opts.title);
  // On encode le markdown en JSON pour pouvoir l'embarquer dans une string JS
  const markdownEncoded = JSON.stringify(markdown);
  const slugEncoded = JSON.stringify(slug);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  <style>
    @page { size: A4; margin: 22mm 20mm; }
    * { box-sizing: border-box; }
    html, body { background: #f3f4f6; }
    body {
      font-family: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;
      color: #1a1a1a;
      margin: 0;
      padding: 0;
      line-height: 1.45;
    }

    /* Barre d'actions flottante (cachée à l'impression) */
    .actions-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #1a1a1a;
      color: white;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    .actions-bar .ab-title {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ab-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border-radius: 8px;
      background: #5e6ad2;
      color: white;
      font-weight: 600;
      font-size: 13px;
      border: none;
      cursor: pointer;
      font-family: inherit;
    }
    .ab-btn:hover { background: #7178e0; }
    .ab-btn.secondary {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }
    .ab-btn.secondary:hover { background: rgba(255, 255, 255, 0.08); }

    /* La page document */
    .page {
      background: white;
      max-width: 800px;
      margin: 24px auto;
      padding: 48px 56px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      border-radius: 4px;
    }

    .header {
      border-bottom: 3px solid #1a1a1a;
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 6px 0;
    }
    .subtitle {
      color: #555;
      font-size: 13px;
      font-weight: 500;
    }
    .meta {
      display: flex;
      gap: 24px;
      margin-top: 12px;
      font-size: 12px;
      color: #666;
      flex-wrap: wrap;
    }
    .meta span strong {
      color: #1a1a1a;
      font-weight: 600;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #777;
      font-weight: 600;
      padding: 10px 12px;
      border-bottom: 1.5px solid #1a1a1a;
    }
    thead th.col-duration { text-align: right; }
    tbody td {
      padding: 11px 12px;
      border-bottom: 1px solid #eaeaea;
      vertical-align: top;
    }
    tbody tr:last-child td { border-bottom: 2px solid #1a1a1a; }
    td.col-time {
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-variant-numeric: tabular-nums;
      color: #555;
      width: 80px;
      font-weight: 600;
    }
    td.col-name { font-weight: 500; }
    td.col-duration {
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-variant-numeric: tabular-nums;
      text-align: right;
      color: #333;
      width: 100px;
    }
    .row-num {
      display: inline-block;
      color: #999;
      font-family: 'Menlo', monospace;
      font-size: 11px;
      margin-right: 10px;
    }
    tfoot td {
      padding: 14px 12px 0;
      font-weight: 600;
      font-size: 12px;
    }
    tfoot td.col-time { color: #1a1a1a; }
    tfoot td.col-name {
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 11px;
    }
    @media print {
      html, body { background: white; }
      .actions-bar { display: none; }
      .page {
        box-shadow: none;
        margin: 0;
        padding: 0;
        max-width: none;
        border-radius: 0;
      }
    }

    @media (max-width: 600px) {
      .page { padding: 28px 20px; margin: 12px; }
      .actions-bar { padding: 10px 12px; gap: 8px; }
      .ab-btn { padding: 8px 12px; font-size: 12px; }
      h1 { font-size: 22px; }
      .meta { gap: 12px; font-size: 11px; }
    }
  </style>
</head>
<body>
  <div class="actions-bar">
    <div class="ab-title">${escapeHtml(opts.title)}</div>
    <button class="ab-btn secondary" onclick="downloadMd()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Markdown
    </button>
    <button class="ab-btn" onclick="downloadPdf()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      PDF
    </button>
  </div>

  <div class="page">
    <div class="header">
      <h1>${escapeHtml(opts.title)}</h1>
      ${opts.subtitle ? `<div class="subtitle">${escapeHtml(opts.subtitle)}</div>` : ''}
      <div class="meta">
        <span>Début&nbsp;<strong>${pad2(h)}:${pad2(m)}</strong></span>
        <span>Fin estimée&nbsp;<strong>${endTime}</strong></span>
        <span>${sequence.steps.length} étape${sequence.steps.length > 1 ? 's' : ''}&nbsp;·&nbsp;<strong>${totalLabel}</strong></span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-time">Heure</th>
          <th class="col-name">Étape</th>
          <th class="col-duration">Durée</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r, i) => `
        <tr>
          <td class="col-time">${r.time}</td>
          <td class="col-name"><span class="row-num">${pad2(i + 1)}</span>${r.name}</td>
          <td class="col-duration">${r.duration}</td>
        </tr>`
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr>
          <td class="col-time">${endTime}</td>
          <td class="col-name">Fin de séquence</td>
          <td class="col-duration">Total ${totalLabel}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <script>
    const MARKDOWN_CONTENT = ${markdownEncoded};
    const FILENAME_SLUG = ${slugEncoded};

    function downloadPdf() {
      // Ouvre le dialog d'impression : l'utilisateur choisit "Enregistrer
      // au format PDF" comme destination
      window.print();
    }

    function downloadMd() {
      const blob = new Blob([MARKDOWN_CONTENT], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = FILENAME_SLUG + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  </script>
</body>
</html>`;
}
