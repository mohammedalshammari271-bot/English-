(() => {
  const fieldSelector = 'input[data-student-id][data-field-key]:not(:disabled)';

  function position(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches(fieldSelector)) return null;
    const rows = Array.from(event.currentTarget.querySelectorAll('tbody tr'))
      .map(row => Array.from(row.querySelectorAll(fieldSelector)))
      .filter(fields => fields.length);
    const row = rows.findIndex(fields => fields.includes(input));
    const column = rows[row]?.indexOf(input) ?? -1;
    return column < 0 ? null : { input, rows, row, column };
  }

  function move(event) {
    const p = position(event);
    if (!p || event.defaultPrevented || event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const horizontal = event.key === 'ArrowLeft' ? (rtl ? 1 : -1)
      : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0;
    const vertical = event.key === 'ArrowDown' || event.key === 'Enter' ? 1
      : event.key === 'ArrowUp' ? -1 : 0;
    if (horizontal) {
      const atEdge = event.key === 'ArrowLeft' ? p.input.selectionStart === 0
        : p.input.selectionEnd === p.input.value.length;
      if (event.shiftKey || !atEdge || p.input.selectionStart !== p.input.selectionEnd) return;
    }
    if (!horizontal && !vertical) return;
    const next = p.rows[p.row + (event.shiftKey ? -vertical : vertical)]?.[p.column + horizontal];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block:'nearest', inline:'nearest' });
    next.select();
  }

  function paste(event, apply, validate, report) {
    const p = position(event);
    const text = event.clipboardData?.getData('text/plain');
    if (!p || !text || !/[\t\n\r]/.test(text)) return;
    event.preventDefault();
    const table = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(row => row.split('\t'));
    const edits = [];
    for (let row = 0; row < table.length; row++) {
      for (let column = 0; column < table[row].length; column++) {
        const input = p.rows[p.row + row]?.[p.column + column];
        if (!input) {
          report('عدد الخلايا المنسوخة أكبر من الخلايا الظاهرة. أضف صفوفاً أو ابدأ من خلية أخرى.');
          return;
        }
        const { studentId, fieldKey } = input.dataset;
        const raw = table[row][column];
        const result = fieldKey === 'name' ? { value:raw.trim() } : validate(raw,
          fieldKey === 'oralExam' ? 30 : fieldKey === 'exam' ? 70 : 10);
        if (result.error) {
          report('قيمة غير صالحة في السطر ' + (row + 1) + '، العمود ' + (column + 1) + ' من البيانات المنسوخة.');
          return;
        }
        edits.push({ studentId, field:fieldKey, value:result.value });
      }
    }
    apply(edits);
    report('تم لصق ' + edits.length + ' خلية.');
  }
  window.gradebookGrid = { move, paste };
})();
