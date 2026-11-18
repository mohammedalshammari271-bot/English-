(() => {
  function usePage(React) {
    const current = () => ['grades','names'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    const [page,setPage] = React.useState(current);
    React.useEffect(() => {
      const change = () => { setPage(current()); window.scrollTo(0,0); };
      window.addEventListener('hashchange',change);
      return () => window.removeEventListener('hashchange',change);
    },[]);
    return [page, next => { location.hash = '#' + next; }];
  }
  function Menu({React,label,children}) {
    const h = React.createElement;
    const ref = React.useRef(null);
    React.useEffect(() => {
      const outside = event => {
        if(ref.current?.open && !ref.current.contains(event.target)) ref.current.open=false;
      };
      document.addEventListener('pointerdown',outside);
      return () => document.removeEventListener('pointerdown',outside);
    },[]);
    return h('details',{className:'nav-menu',ref,
      onKeyDown:event=>{
        if(event.key==='Escape'){
          event.currentTarget.open=false;
          event.currentTarget.querySelector('summary').focus();
        }
      },
      onClick:event=>{ if(event.target.closest('button,a')) event.currentTarget.open=false; }},
      h('summary',null,label),h('div',{className:'nav-menu-body'},children));
  }
  function Header({React,page,children}) {
    const h=React.createElement;
    return h('header',{className:'nav-header'},
      h('a',{className:'nav-brand',href:'#home'},'دفتر الإنكليزي'),
      page!=='home' && h('a',{href:'#home',className:'nav-back'},'الرئيسية'),children);
  }
  function Home({React}) {
    const h=React.createElement;
    return h('section',{className:'home-page'},
      h('h1',null,'دفتر درجات الإنكليزي'),
      h('div',{className:'home-links'},
        h('a',{href:'#grades'},h('strong',null,'دفتر الدرجات'),h('span',null,'اختر الصف والشهر وابدأ إدخال الدرجات.')),
        h('a',{href:'#names'},h('strong',null,'استيراد الأسماء'),h('span',null,'من ملف أو صورة إلى قائمة قابلة للتعديل.'))));
  }
  window.gradebookNavigation={usePage,Menu,Header,Home};
})();
