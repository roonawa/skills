'use strict';

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTable(lines) {
  const tableLines = lines.filter((line) => line.trim().startsWith('|'));
  if (tableLines.length === 0) return { headers: [], rows: [] };

  const parsedRows = tableLines.map(splitRow);
  const headers = parsedRows[0];
  const rows = parsedRows.slice(1).filter((row) => !isSeparatorRow(row));
  return { headers, rows };
}

function extractSection(lines, headingPattern) {
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex === -1) return '';

  const collected = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) break;
    collected.push(lines[i]);
  }
  return collected.join('\n').trim();
}

function parseSpec(markdown) {
  const lines = markdown.split(/\r?\n/);

  const titleLine = lines.find((line) => line.trim().startsWith('# '));
  if (!titleLine) {
    throw new Error('タイトル行（# テスト仕様書：...）が見つかりません');
  }
  const title = titleLine.trim().replace(/^#\s*/, '');
  const titleIndex = lines.indexOf(titleLine);

  const metaTableLines = [];
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('|')) {
      metaTableLines.push(line);
    } else if (metaTableLines.length > 0) {
      break;
    }
  }
  const metaTable = parseTable(metaTableLines);
  const meta = metaTable.rows.map((row) => ({ key: row[0], value: row[1] }));

  const policyText = extractSection(lines, /^##\s*1\.\s*テスト方針・前提/);
  const envText = extractSection(lines, /^##\s*2\.\s*テスト環境・データ/);
  const criteriaText = extractSection(lines, /^##\s*5\.\s*合否基準・残課題/);

  const tcHeadingIndex = lines.findIndex((line) => /^##\s*3\.\s*テストケース/.test(line.trim()));
  if (tcHeadingIndex === -1) {
    throw new Error('「## 3. テストケース」セクションが見つかりません');
  }
  const tcSectionLines = [];
  for (let i = tcHeadingIndex + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) break;
    tcSectionLines.push(lines[i]);
  }
  const tcTable = parseTable(tcSectionLines);
  const testCases = tcTable.rows.map((row) => {
    const record = {};
    tcTable.headers.forEach((header, idx) => {
      record[header] = row[idx] !== undefined ? row[idx] : '';
    });
    return {
      id: record['TC-ID'] || '',
      name: record['テスト名'] || '',
      kind: record['種別'] || '',
      steps: record['手順'] || '',
      expected: record['期待結果'] || '',
      upstreamId: record['上流ID'] || '',
      note: record['備考'] || '',
    };
  });

  return { title, meta, policyText, envText, criteriaText, testCases };
}

module.exports = { splitRow, isSeparatorRow, parseTable, parseSpec };
