(() => {
  function useView(React) {
    return React.useState('grid');
  }

  function StudentForm({ React, rows, rowId, choose, fields, update, statusValue, readOnly, threshold, calculate, actions, ScoreInput }) {
    const h = React.createElement;
    const index = Math.max(0, rows.findIndex(row => row.id === rowId));
    const row = rows[index];
    if (!row) return h('p', { className:'student-empty' }, 'ماكو طلاب يطابقون البحث أو الفلتر.');
    const score = calculate(row);
    const result = score.total === null ? 'غير مكتمل' : score.total < threshold ? 'راسب' : 'ناجح';
    const chooseOffset = offset => choose(rows[index + offset].id);
    return h('section', { className:'student-editor', 'aria-label':'إدخال درجات طالب' },
      h('div', { className:'student-nav' },
        h('label', null, 'اختيار الطالب',
          h('select', { value:row.id, onChange:event => choose(event.target.value) },
            rows.map((entry, position) => h('option', {key:entry.id, value:entry.id},
              (position + 1) + ' · ' + (entry.name || 'اسم جديد'))))),
        h('div', { className:'student-stepper' },
          h('button', { type:'button', disabled:index===0, onClick:() => chooseOffset(-1) }, 'السابق'),
          h('span', null, (index + 1) + ' من ' + rows.length),
          h('button', { type:'button', disabled:index===rows.length-1, onClick:() => chooseOffset(1) }, 'التالي'))
      ),
      h('label', { className:'student-name' }, 'اسم الطالب',
        h('input', { value:row.name, disabled:readOnly, autoComplete:'off',
          placeholder:'اكتب الاسم', onChange:event => update(row.id,'name',event.target.value) })),
      h('div', { className:'student-scores' }, fields.map(([field,label,max]) =>
        h('div', {className:'student-score',key:field},
          h('span', {className:'student-score-label'}, label, h('small', null, 'من ' + max)),
          h(ScoreInput, {value:row[field], max, label, disabled:readOnly,
            className:'fast-score', onChange:value => update(row.id,field,value)}),
          !readOnly && h('select', {
            'aria-label':'حالة ' + label, value:statusValue(row[field]),
            onChange:event => update(row.id,field,event.target.value)
          }, h('option',{value:''},'درجة'), h('option',{value:'غائب'},'غائب'), h('option',{value:'مؤجل'},'مؤجل'))
        ))),
      h('div', {className:'student-totals'},
        score.sum !== null && h('span',null,'المهارات ',h('strong',null,format(score.sum) + ' / 60')),
        h('span',null,'الشفوي ', h('strong',null,format(score.oral) + ' / 30')),
        h('span',null,'المجموع ', h('strong',null,format(score.total) + ' / 100')),
        h('span',{className:'student-result','data-result':result},result)),
      !readOnly && h('details',{className:'workspace-disclosure student-actions'},
        h('summary',null,'إجراءات الطالب'),
        h('div',{className:'action-cluster'},
          actions.map(([label, run, needsName]) => h('button', {
            type:'button',key:label,disabled:needsName && !row.name.trim(),onClick:() => run(row.id)
          }, label))))
    );
  }
  function format(value) { return value === null ? '—' : Number(value.toFixed(2)); }
  window.gradebookWorkspace = { useView, StudentForm };
})();
