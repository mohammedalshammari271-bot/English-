(() => {
  const loaders=new Map();
  const validName = name => /\p{L}/u.test(name) &&
    !/^(?:ت|م|اسم|الاسم|الأسماء|الاسماء|اسم (?:الطالب|الطالبة|التلميذ|التلميذة)(?: الكامل| الثلاثي| الرباعي)?|الاسم (?:الكامل|الثلاثي|الرباعي)|names?|student name|full name)$/iu.test(name);
  function clean(value) {
    return String(value??'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'')
      .replace(/^\s*(?:[•●▪]|\(?[0-9٠-٩۰-۹]+\)?(?:\s*[.)،:ـ–-]\s*|\s+))/u,'')
      .replace(/[\s|]+[0-9٠-٩۰-۹]+\s*$/u,'').replace(/^[\s|،,;:]+|[\s|،,;:]+$/gu,'')
      .replace(/\s+/gu,' ').trim();
  }
  function textRows(text) {return text.replace(/^\uFEFF/u,'').split(/\r\n?|\n/u).map(line=>[line]);}
  function script(path,global) {
    if(window[global]) return Promise.resolve(window[global]);
    if(!loaders.has(path)){
      const promise=new Promise((resolve,reject)=>{
        const el=document.createElement('script');
        const fail=()=>{clearTimeout(timer);el.remove();reject(new Error('تعذّر تحميل قارئ الملف. جرّب مجدداً.'));};
        const timer=setTimeout(fail,20000);
        el.src=path;el.onload=()=>{clearTimeout(timer);window[global]?resolve(window[global]):fail();};el.onerror=fail;
        document.head.append(el);
      });
      loaders.set(path,promise);promise.catch(()=>loaders.delete(path));
    }
    return loaders.get(path);
  }
  function decode(bytes){
    if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes);
    if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be').decode(bytes);
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch{return new TextDecoder('windows-1256').decode(bytes);}
  }
  async function readDocx(bytes){
    const Zip=await script('/vendor/jszip.min.js','JSZip');
    const zip=await Zip.loadAsync(bytes);
    const part=zip.file('word/document.xml');
    if(!part)throw new Error('ما ظهر مستند Word قابل للقراءة.');
    const text=await part.async('string');
    if(text.length>20_000_000)throw new Error('المستند كبير. قسّمه إلى ملفات أصغر.');
    const xml=new DOMParser().parseFromString(text,'application/xml');
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body=xml.getElementsByTagNameNS(ns,'body')[0];
    if(!body)throw new Error('بنية ملف Word غير صالحة.');
    const content=node=>Array.from(node.getElementsByTagNameNS(ns,'t'),item=>item.textContent).join('');
    const datasets=Array.from(body.getElementsByTagNameNS(ns,'tbl'),(table,index)=>({
      label:'جدول '+(index+1),rows:Array.from(table.children).filter(n=>n.localName==='tr')
        .map(row=>Array.from(row.children).filter(n=>n.localName==='tc').map(content))
    }));
    const paragraphs=Array.from(body.children).filter(n=>n.localName==='p').map(n=>[content(n)]).filter(row=>row[0].trim());
    return paragraphs.length?[...datasets,{label:'نص Word',rows:paragraphs}]:datasets;
  }
  async function readPdf(bytes){
    const pdf=await import('/vendor/pdf.min.mjs');
    pdf.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
    const task=pdf.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false});
    try{
      const document=await task.promise;
      if(document.numPages>30)throw new Error('اختَر PDF من ٣٠ صفحة أو أقل.');
      const rows=[];
      for(let i=1;i<=document.numPages;i++){
        const page=await document.getPage(i);
        const {items}=await page.getTextContent();
        let line=[],baseline;
        const flush=()=>{if(line.length)rows.push([line.join(' ')]);line=[];};
        for(const item of items){
          if(!('str' in item))continue;
          const y=item.transform?.[5];
          if(baseline!==undefined&&Math.abs(y-baseline)>4)flush();
          if(item.str.trim())line.push(item.str);
          baseline=y;
          if(item.hasEOL)flush();
        }
        flush();page.cleanup();
      }
      if(!rows.some(row=>/\p{L}/u.test(row[0])))throw new Error('هذا PDF مصوّر. ارفع صورة صفحة الأسماء بقارئ الصور.');
      return [{label:'نص PDF',rows}];
    }finally{await task.destroy();}
  }
  async function imageCanvas(file){
    const url=URL.createObjectURL(file);
    try{
      const image=await new Promise((resolve,reject)=>{
        const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('الصورة ما انفتحت. جرّب JPG أو PNG.'));img.src=url;
      });
      const scale=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);return canvas;
    }finally{URL.revokeObjectURL(url);}
  }
  async function recognize(file,language,notify,job){
    const canvas=await imageCanvas(file);
    const T=await script('/vendor/tesseract.min.js','Tesseract');
    try{
      const operation=async()=>{
        const worker=await T.createWorker(language,1,{
          workerPath:'/vendor/tesseract-worker.min.js',
          corePath:'/vendor/tesseract-core-lstm.wasm.js',
          langPath:location.origin+'/vendor/ocr',
          logger:message=>{if(message.status==='recognizing text')notify('جارٍ قراءة الصورة… '+Math.round(message.progress*100)+'٪');},
          errorHandler:()=>{}
        });
        job.worker=worker;
        if(job.cancelled){await worker.terminate();throw new Error('أُلغيت القراءة.');}
        await worker.setParameters({tessedit_pageseg_mode:T.PSM.SPARSE_TEXT});
        const {data}=await worker.recognize(canvas);
        return [{label:'النص من الصورة',rows:textRows(data.text)}];
      };
      return await Promise.race([operation(),new Promise((_,reject)=>{
        job.timer=setTimeout(()=>{job.cancelled=true;job.worker?.terminate();reject(new Error('القراءة أخذت وقت طويل. قص عمود الأسماء أو اختَر صورة أصغر.'));},90000);
        job.reject=reject;
      })]);
    }finally{clearTimeout(job.timer);await job.worker?.terminate();canvas.width=0;}
  }
  async function read(file,kind,language,notify,job,spreadsheet){
    if(!file.size||file.size>12*1024*1024)throw new Error('حجم الملف المطلوب بين صفر و١٢ ميغابايت.');
    const extension=file.name.split('.').at(-1).toLowerCase();
    if(kind==='image'){
      if(!file.type.startsWith('image/')&&!/^(?:jpg|jpeg|png|webp|bmp|gif|avif)$/.test(extension))throw new Error('اختَر صورة أسماء.');
      return recognize(file,language,notify,job);
    }
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(extension==='docx')return readDocx(bytes);
    if(extension==='pdf')return readPdf(bytes);
    if(extension==='txt')return [{label:'نص الملف',rows:textRows(decode(bytes))}];
    if(['xlsx','xls','ods','csv','tsv'].includes(extension))return spreadsheet(['csv','tsv'].includes(extension)?decode(bytes):bytes,extension);
    throw new Error('الصيغة المدعومة Excel أو ODS أو CSV أو TSV أو TXT أو Word DOCX أو PDF نصّي.');
  }
  function suggest(dataset){
    for(const [index,row]of dataset.rows.slice(0,15).entries()){
      const column=row.findIndex(value=>/^(?:الاسم|اسم|اسم الطالب(?: الكامل| الثلاثي| الرباعي)?|اسم الطالبة|الاسم الكامل|student name|full name|name)$/iu.test(String(value).trim()));
      if(column>=0)return {column,first:index+2};
    }
    let best={column:0,first:1,score:-1};
    const width=Math.max(1,...dataset.rows.slice(0,30).map(row=>row.length));
    for(let column=0;column<width;column++){
      const score=dataset.rows.slice(0,30).filter(row=>validName(clean(row[column]))).length;
      if(score>best.score)best={column,first:1,score};
    }
    return best;
  }
  function ImportPage({React,groups,selectedGroup,onImport,spreadsheet}){
    const h=React.createElement;
    const [target,setTarget]=React.useState(selectedGroup||groups[0]?.id||'');
    const [kind,setKind]=React.useState('file');
    const [language,setLanguage]=React.useState('ara');
    const [datasets,setDatasets]=React.useState([]);
    const [sheet,setSheet]=React.useState(0);
    const [column,setColumn]=React.useState(0);
    const [first,setFirst]=React.useState(1);
    const [names,setNames]=React.useState([]);
    const [filename,setFilename]=React.useState('');
    const [message,notify]=React.useState('');
    const [error,setError]=React.useState('');
    const [busy,setBusy]=React.useState(false);
    const [duplicates,setDuplicates]=React.useState(false);
    const activeJob=React.useRef(null);
    const counter=React.useRef(0);
    function cancel(){
      const job=activeJob.current;
      if(job){job.cancelled=true;job.worker?.terminate();job.reject?.(new Error('أُلغيت القراءة.'));}
      activeJob.current=null;setBusy(false);notify('');
    }
    React.useEffect(()=>()=>{const job=activeJob.current;if(job){job.cancelled=true;job.worker?.terminate();job.reject?.(new Error('أُلغيت القراءة.'));}},[]);
    function extract(dataset,col,row){
      const extracted=dataset.rows.slice(Math.max(0,row-1)).map(item=>clean(item[col])).filter(validName);
      if(extracted.length>2000){setError('أكثر من ٢٠٠٠ اسم. قسّم الملف إلى دفعات.');setNames([]);return;}
      setError(extracted.length?'':'ما ظهرت أسماء. غيّر العمود أو أول صف للأسماء.');
      setNames(extracted.map(name=>({id:counter.current++,name})));
    }
    function chooseSheet(index,sources=datasets){
      const guess=suggest(sources[index]);setSheet(index);setColumn(guess.column);setFirst(guess.first);extract(sources[index],guess.column,guess.first);
    }
    async function chooseFile(event){
      const file=event.target.files[0];event.target.value='';if(!file)return;
      const job={cancelled:false};activeJob.current=job;
      setFilename(file.name);setNames([]);setDatasets([]);setBusy(true);setError('');notify('جارٍ فتح '+(kind==='image'?'قارئ الصورة…':'الملف…'));
      try{
        const sources=(await read(file,kind,language,text=>{if(!job.cancelled)notify(text);},job,spreadsheet))
          .filter(dataset=>dataset.rows.some(row=>row.some(value=>String(value??'').trim())));
        if(job.cancelled)return;
        if(!sources.length)throw new Error('ما ظهر محتوى مقروء داخل الملف.');
        setDatasets(sources);chooseSheet(0,sources);
      }catch(reason){if(!job.cancelled)setError(reason.message||'تعذّرت القراءة.');}
      finally{if(!job.cancelled){setBusy(false);notify('');activeJob.current=null;}}
    }
    const dataset=datasets[sheet],selected=groups.find(group=>group.id===target);
    const count=names.filter(item=>item.name.trim()).length;
    const columns=dataset?Math.max(1,...dataset.rows.slice(0,30).map(row=>row.length)):1;
    function submit(event){
      event.preventDefault();if(!selected||!count||busy)return;
      const result=onImport(target,names.map(item=>item.name.trim()).filter(Boolean),duplicates);
      if(result.missing){setError('الصف المحدد ما عاد موجود. اختَر صفاً آخر.');return;}
      if(!result.added){setError('الأسماء كلها موجودة. عدّلها أو اسمح بتكرار الأسماء.');return;}
      setNames([]);setDatasets([]);setFilename('');setError('');notify('تمت إضافة '+result.added+' اسم.'+(result.skipped?' تجاوزنا '+result.skipped+' اسم متكرر.':''));
    }
    return h('section',{className:'names-page'},
      h('h1',null,'استيراد الأسماء'),h('form',{onSubmit:submit},
        h('label',{className:'names-field'},'الصف والشعبة',h('select',{value:target,onChange:event=>setTarget(event.target.value),required:true},
          h('option',{value:'',disabled:true},'اختر الصف'),groups.map(group=>h('option',{value:group.id,key:group.id},group.label)))),
        !groups.length&&h('p',null,'أنشئ صفاً من ',h('a',{href:'#grades'},'دفتر الدرجات'),' أولاً.'),
        h('div',{className:'names-switch'},
          h('button',{type:'button',disabled:busy,'aria-pressed':kind==='file',onClick:()=>setKind('file')},'من ملف'),
          h('button',{type:'button',disabled:busy,'aria-pressed':kind==='image',onClick:()=>setKind('image')},'من صورة')),
        kind==='image'&&h(React.Fragment,null,
          h('label',{className:'names-field'},'لغة الأسماء',h('select',{value:language,disabled:busy,onChange:event=>setLanguage(event.target.value)},
            h('option',{value:'ara'},'عربي'),h('option',{value:'eng'},'إنكليزي'),h('option',{value:'ara+eng'},'عربي وإنكليزي'))),
          h('p',null,'اختَر صورة واضحة أو قص عمود الأسماء. القراءة داخل متصفحك. راجع النتيجة وصحّحها قبل الإضافة.'),h('p',null,'أول قراءة تحتاج إنترنت لتنزيل نموذج اللغة المجاني.')),
        h('label',{className:'names-field names-file'},kind==='image'?'اختيار صورة الأسماء':'اختيار ملف الأسماء',
          h('input',{type:'file',disabled:busy,onChange:chooseFile,accept:kind==='image'?'image/*':'.xlsx,.xls,.ods,.csv,.tsv,.txt,.docx,.pdf'})),
        filename&&h('p',{className:'names-filename'},filename),
        kind==='file'&&h('p',null,'Excel · ODS · CSV · TSV · TXT · Word DOCX · PDF نصّي'),
        message&&h('p',{role:'status'},message),error&&h('p',{role:'alert',className:'names-error'},error),
        busy&&h('button',{type:'button',onClick:cancel},'إلغاء القراءة'),
        dataset&&h('div',{className:'names-mapping'},
          datasets.length>1&&h('label',{className:'names-field'},'الورقة أو الجدول',h('select',{value:sheet,onChange:event=>chooseSheet(Number(event.target.value))},
            datasets.map((source,index)=>h('option',{key:index,value:index},source.label)))),
          columns>1&&h('label',{className:'names-field'},'عمود الاسم',h('select',{value:column,onChange:event=>{const col=Number(event.target.value);setColumn(col);extract(dataset,col,first);}},
            Array.from({length:columns},(_,index)=>h('option',{value:index,key:index},'عمود '+(index+1)+' · '+String(dataset.rows[first-1]?.[index]||'').slice(0,40))))),
          h('label',{className:'names-field'},'أول صف للأسماء',h('input',{type:'number',inputMode:'numeric',min:1,max:dataset.rows.length,value:first,onChange:event=>{
            if(!event.target.value){setFirst('');return;}const row=Math.min(dataset.rows.length,Math.max(1,Number(event.target.value)));setFirst(row);extract(dataset,column,row);
          }}))),
        names.length>0&&h(React.Fragment,null,h('h2',null,'مراجعة الأسماء ('+count+')'),
          h('ol',{className:'names-preview'},names.map((item,index)=>h('li',{key:item.id},
            h('span',{'aria-hidden':true},index+1),
            h('input',{type:'text',value:item.name,maxLength:200,'aria-label':'اسم الطالب '+(index+1),onChange:event=>{
              const value=event.target.value;setNames(previous=>previous.map(row=>row.id===item.id?{...row,name:value}:row));
            }}),
            h('button',{type:'button','aria-label':'إزالة الاسم '+(index+1),onClick:()=>setNames(previous=>previous.filter(row=>row.id!==item.id))},'إزالة')))),
          h('label',{className:'names-duplicates'},h('input',{type:'checkbox',checked:duplicates,onChange:event=>setDuplicates(event.target.checked)}),'السماح بتكرار الأسماء'),
          h('button',{type:'submit',className:'names-submit',disabled:!selected||!count||busy},'إضافة '+count+' اسم إلى الصف'))));
  }
  window.gradebookNames={ImportPage};
})();
