/* Shared top nav + theme toggle for all concept pages.
   Include after concept.css. Builds nav, highlights the current file, wires light/dark. */
(function(){
  var PAGES=[
    {f:'home-search.html',  t:'Home'},
    {f:'choose.html',       t:'Choose'},
    {f:'program.html',      t:'Program'},
    {f:'courses.html',      t:'Courses'},
    {f:'prereqs.html',      t:'Prereqs'},
    {f:'transfers.html',    t:'Transfer'},
    {f:'schedule.html',     t:'Schedule'},
    {f:'compare-outcomes.html', t:'Outcomes'},
    {f:'journey-dashboard.html', t:'Dashboard'},
    {f:'us-map.html',       t:'Map'}
  ];
  var cur=(location.pathname.split('/').pop()||'').toLowerCase();
  var logo='<svg class="ic" style="width:16px;height:16px;stroke:currentColor" viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c0 1 2 2 5 2s5-1 5-2v-5"/></svg>';
  var links=PAGES.map(function(p){
    return '<a href="'+p.f+'"'+(p.f===cur?' class="on"':'')+'>'+p.t+'</a>';
  }).join('');
  var moon='<svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
  var html='<div class="cnav"><div class="row">'+
    '<a class="brand" href="index.html"><span class="logo">'+logo+'</span>Community College Path</a>'+
    '<nav class="links">'+links+'</nav>'+
    '<button class="tt" id="cnav-tt">'+moon+' <span id="cnav-ttl">Dark</span></button>'+
    '</div></div>';
  function mount(){
    var holder=document.createElement('div'); holder.innerHTML=html;
    document.body.insertBefore(holder.firstChild, document.body.firstChild);
    var root=document.documentElement, lbl=document.getElementById('cnav-ttl');
    function sync(){ lbl.textContent = root.getAttribute('data-theme')==='dark' ? 'Light' : 'Dark'; }
    document.getElementById('cnav-tt').addEventListener('click',function(){
      root.setAttribute('data-theme', root.getAttribute('data-theme')==='dark'?'light':'dark'); sync();
    });
    sync();
  }
  if(document.body) mount(); else document.addEventListener('DOMContentLoaded',mount);
})();
