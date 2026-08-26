import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyD1Overrides, loadD1Overrides } from "./lib/d1-overrides.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "..");
const target = resolve(process.env.HUSIR_STATIC_OUT || join(project, "..", "GitHub-Pages发布"));
const patchOnly = process.env.HUSIR_STATIC_PATCH_ONLY === "1";

if (patchOnly) {
  if (!existsSync(join(target, "index.html"))) throw new Error(`静态站目录无效：${target}`);
  const overrides = await loadD1Overrides({ required: true });
  console.log(JSON.stringify({ mode: "patch", target, overrides: applyD1Overrides(target, overrides) }));
  process.exit(0);
}

const source = resolve(process.env.HUSIR_LEGACY_DIR || join(project, "..", "整站静态页面"));
const catalog = JSON.parse(readFileSync(join(project, "src/data/catalog.json"), "utf8"));
const chapters = JSON.parse(readFileSync(join(project, "src/data/chapters.json"), "utf8"));
const works = new Map(catalog.works.map((work) => [work.slug, work]));
const chaptersByWork = new Map();
for (const chapter of chapters) {
  const list = chaptersByWork.get(chapter.workSlug) || [];
  list.push(chapter);
  chaptersByWork.set(chapter.workSlug, list);
}

if (!existsSync(join(source, "index.html"))) throw new Error(`旧站目录无效：${source}`);
if (!existsSync(join(target, ".git"))) throw new Error(`发布目录必须是独立 Git 工作副本：${target}`);

const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const strip = (value = "") => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const meta = (html, name) => html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] || "";
const ensure = (path) => mkdirSync(dirname(path), { recursive: true });
const write = (relative, content) => { const path = join(target, relative); ensure(path); writeFileSync(path, content); };
const readLegacy = (relative) => readFileSync(join(source, relative), "utf8");

function header() {
  return `<header class="site-header"><a class="brand" href="/" aria-label="虎思国学网首页"><img src="/logo.svg" alt="虎思国学网" width="238" height="54"></a><nav class="main-nav" aria-label="主要栏目"><a href="/">首页</a><a href="/jing/">经</a><a href="/shi/">史</a><a href="/zi/">子</a><a href="/ji/">集</a></nav><nav class="user-nav" aria-label="个人功能"><a href="/bookshelf/">我的书架</a><a href="/account/">登录</a></nav></header>`;
}

function footer() {
  return `<footer class="site-footer"><section class="friend-links" aria-labelledby="friend-title"><h2 id="friend-title">友情链接</h2><div id="friend-links-list"><a href="https://husir.cn/">虎思国学网</a></div></section><div class="footer-meta"><span>公益性传统文化阅读网站</span><span>Copyright © 2002–2026 Husir.cn</span><a target="_blank" rel="nofollow noopener" href="https://beian.miit.gov.cn">闽ICP备2022000160号-2</a></div></footer>`;
}

function page({ title, description, path, body, script = "" }) {
  const fullTitle = title.includes("虎思国学网") ? title : `${title}｜虎思国学网`;
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fullTitle)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="https://husir.cn${path}"><link rel="stylesheet" href="/site.css?v=20260826g"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="any"><meta name="theme-color" content="#102a43"></head><body>${header()}<main>${body}</main>${footer()}<script src="/app.js?v=20260826g"></script>${script}</body></html>`;
}

function crumbs(items) {
  return `<nav class="breadcrumbs"><a href="/">首页</a>${items.map((item) => `<span>›</span>${item.href ? `<a href="${item.href}">${esc(item.label)}</a>` : `<strong>${esc(item.label)}</strong>`}`).join("")}</nav>`;
}

function bookCard(work) {
  const cover = work.cover || "/cover-placeholder.svg";
  const intro = work.introduction || work.description || `《${work.title}》在线阅读。`;
  return `<article class="book-card" data-book="${esc(work.slug)}"><a class="book-cover" href="/${esc(work.slug)}/" tabindex="-1"><img src="${esc(cover)}" loading="lazy" decoding="async" alt="《${esc(work.title)}》封面"></a><div class="book-info"><div class="book-title-row"><span class="seal-dot" aria-hidden="true">典</span><h3><a href="/${esc(work.slug)}/">${esc(work.title)}</a></h3><button class="favorite-button" type="button" data-favorite="${esc(work.slug)}" data-title="${esc(work.title)}">☆ 收藏</button></div><p class="book-meta"><b>作者：</b>${esc(work.author || "不详")}<span><b>年代：</b>${esc(work.dynasty || "不详")}</span></p><p class="book-intro"><b>作品简介：</b>${esc(intro)}</p><div class="book-actions"><a href="/${esc(work.slug)}/">开始阅读</a><span>${work.chapterCount} 篇</span></div></div></article>`;
}

const featured = ["yijing", "huangdineijing", "shanhaijing", "shiji", "zizhitongjian", "sunzibingfa"].map((slug) => works.get(slug)).filter(Boolean);
const homeSections = catalog.departments.map((department) => {
  const items = catalog.works.filter((work) => work.department === department.slug).slice(0, 6);
  return `<section><div class="section-heading"><h2>${department.name}部</h2><span>${esc(department.description)}</span><a href="/${department.slug}/">全部 ${department.workCount} 部 →</a></div><div class="book-grid">${items.map(bookCard).join("")}</div></section>`;
}).join("");
const searchScript = `<script>(()=>{const input=document.querySelector('#catalog-search-input'),clear=document.querySelector('#catalog-search-clear'),status=document.querySelector('#catalog-search-status'),section=document.querySelector('#search-results-section'),results=document.querySelector('#search-results'),defaults=document.querySelector('#catalog-default-content');let books=null;const add=(p,t,x,c)=>{const e=document.createElement(t);if(c)e.className=c;e.textContent=x;p.append(e);return e};const card=b=>{const a=document.createElement('article');a.className='book-card';const cover=add(a,'a','');cover.className='book-cover';cover.href='/'+b.slug+'/';const img=document.createElement('img');img.src=b.cover||'/cover-placeholder.svg';img.loading='lazy';img.alt='《'+b.title+'》封面';cover.append(img);const info=add(a,'div','', 'book-info'),row=add(info,'div','', 'book-title-row');add(row,'span','典','seal-dot');const h=add(row,'h3',''),link=add(h,'a',b.title);link.href='/'+b.slug+'/';add(info,'p','作者：'+(b.author||'不详')+'　年代：'+(b.dynasty||'不详'),'book-meta');add(info,'p','作品简介：'+(b.introduction||b.description||''),'book-intro');const actions=add(info,'div','', 'book-actions'),read=add(actions,'a','开始阅读');read.href='/'+b.slug+'/';add(actions,'span',b.chapterCount+' 篇');return a};const run=()=>{const q=input.value.trim().toLowerCase();clear.hidden=!q;if(!q){section.hidden=true;defaults.hidden=false;status.textContent='可检索全馆 ${catalog.totals.works} 部典籍';return}const found=(books||[]).filter(b=>b.search.includes(q)).slice(0,30);results.replaceChildren(...found.map(card));section.hidden=false;defaults.hidden=true;status.textContent='找到 '+found.length+' 部典籍'};input.addEventListener('focus',()=>{if(books)return;fetch('/catalog-search.json').then(r=>r.json()).then(data=>{books=data;run()}).catch(()=>status.textContent='检索索引加载失败')},{once:true});input.addEventListener('input',()=>books&&run());clear.addEventListener('click',()=>{input.value='';run();input.focus()})})();</script>`;
const homeBody = `<div class="page-shell"><section class="museum-bar"><h1>经史子集 · 中华典藏</h1><p>像翻开一本书一样，从封面进入典籍；收藏与阅读进度自动保存在你的书架。</p><span class="count">收录 ${catalog.totals.works} 部 · ${catalog.totals.chapters.toLocaleString()} 篇</span></section><section class="catalog-search" role="search"><label for="catalog-search-input">典籍检索</label><div class="catalog-search-box"><input id="catalog-search-input" type="search" placeholder="输入书名、作者、朝代或简介，例如：易经、司马迁、先秦" autocomplete="off"><button id="catalog-search-clear" type="button" hidden>清除</button></div><span id="catalog-search-status">可检索全馆 ${catalog.totals.works} 部典籍</span></section><section id="search-results-section" hidden><div class="section-heading"><h2>检索结果</h2></div><div id="search-results" class="book-grid"></div></section><div id="catalog-default-content"><div class="section-heading"><h2>馆藏精选</h2><a href="/bookshelf/">查看我的书架 →</a></div><section class="book-grid">${featured.map(bookCard).join("")}</section>${homeSections}</div></div>`;
write("index.html", page({ title: "虎思国学网｜经史子集在线阅读", description: "虎思国学网收录经、史、子、集传统典籍，提供免费在线阅读、收藏与阅读记录。", path: "/", body: homeBody, script: searchScript }));

for (const department of catalog.departments) {
  const sections = catalog.categories.filter((category) => category.department === department.slug).map((category) => {
    const items = catalog.works.filter((work) => work.department === department.slug && work.categorySlug === category.slug);
    return `<section id="${category.slug}"><div class="section-heading"><h2>${esc(category.name)}</h2><span>${items.length} 部</span></div><div class="book-grid">${items.map(bookCard).join("")}</div></section>`;
  }).join("");
  const strips = catalog.categories.filter((category) => category.department === department.slug).map((category) => `<a href="#${category.slug}">${esc(category.name)}</a>`).join("");
  const body = `<div class="page-shell">${crumbs([{ label: `${department.name}部` }])}<section class="museum-bar"><h1>${department.name}部</h1><p>${esc(department.description)}</p><span class="count">共 ${department.workCount} 部</span></section><div class="category-strip">${strips}</div>${sections}</div>`;
  write(`${department.slug}/index.html`, page({ title: `${department.name}部典籍`, description: department.description, path: `/${department.slug}/`, body }));
}

let generatedChapters = 0;
let skippedChapters = 0;
for (const work of catalog.works) {
  const workChapters = (chaptersByWork.get(work.slug) || []).sort((a, b) => a.order - b.order);
  const first = workChapters[0]?.path || "#chapters";
  const body = `<div class="page-shell">${crumbs([{ label: `${catalog.departments.find((d) => d.slug === work.department)?.name || "典籍"}部`, href: `/${work.department}/` }, { label: work.title }])}<article class="work-hero" data-book="${esc(work.slug)}"><a class="book-cover" href="${first}"><img src="${esc(work.cover || "/cover-placeholder.svg")}" alt="《${esc(work.title)}》封面"></a><div><h1>《${esc(work.title)}》</h1><p class="book-meta"><b>作者：</b>${esc(work.author || "不详")}<span><b>年代：</b>${esc(work.dynasty || "不详")}</span><span><b>分类：</b>${esc(work.categoryName)}</span></p><p class="summary">${esc(work.introduction || work.description)}</p><div class="work-toolbar"><a class="primary-button" href="${first}">开始阅读</a><button class="secondary-button favorite-button" data-favorite="${esc(work.slug)}" data-title="${esc(work.title)}">☆ 收藏</button></div></div></article><section id="chapters"><div class="section-heading"><h2>作品正文</h2><span>共 ${workChapters.length} 篇</span></div><div class="chapter-list">${workChapters.map((item) => `<a href="${item.path}" title="${esc(item.title)}">${esc(item.title)}</a>`).join("")}</div></section></div>`;
  write(`${work.slug}/index.html`, page({ title: `《${work.title}》全文在线阅读`, description: work.description || work.introduction || `《${work.title}》全文在线阅读`, path: `/${work.slug}/`, body }));

  for (let index = 0; index < workChapters.length; index += 1) {
    const chapter = workChapters[index];
    const relative = chapter.path.replace(/^\//, "");
    const legacy = readLegacy(relative);
    const bodyMatch = legacy.match(/<div[^>]*class=["']wenzbody["'][^>]*>([\s\S]*?)<div[^>]*wenzabout[^>]*>/i);
    if (!bodyMatch) { skippedChapters += 1; continue; }
    const title = strip(legacy.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || chapter.title);
    const departmentName = catalog.departments.find((item) => item.slug === work.department)?.name || "典籍";
    const previous = index > 0 ? workChapters[index - 1] : null;
    const next = index < workChapters.length - 1 ? workChapters[index + 1] : null;
    const articleHtml = bodyMatch[1].replace(/<\/div>\s*$/i, "");
    const readerBody = `<div class="reader-shell" data-reader data-work="${esc(work.slug)}" data-work-title="${esc(work.title)}" data-title="${esc(title)}">${crumbs([{ label: `${departmentName}部`, href: `/${work.department}/` }, { label: work.title, href: `/${work.slug}/` }, { label: title }])}<div class="reader-toolbar"><a href="/${work.slug}/">☰ 目录</a><button data-font="-2">字小</button><button data-font="2">字大</button><span class="spacer"></span><button class="favorite-button" data-favorite="${esc(work.slug)}" data-title="${esc(work.title)}">☆ 收藏</button></div><article class="reader-paper"><h1>${esc(title)}</h1><div class="reader-content">${articleHtml}</div></article><nav class="reader-nav">${previous ? `<a rel="prev" href="${previous.path}">← ${esc(previous.title)}</a>` : "<span></span>"}${next ? `<a rel="next" href="${next.path}">${esc(next.title)} →</a>` : "<span></span>"}</nav></div>`;
    write(relative, page({ title, description: meta(legacy, "description") || `${title}在线阅读`, path: chapter.path, body: readerBody }));
    generatedChapters += 1;
  }
}

const accountBody = `<div class="page-shell">${crumbs([{ label: "读者账户" }])}<section class="panel"><h1>轻量书架账户</h1><p class="notice">无需邮箱和手机号。注册后请妥善保存“书架编号”和“恢复码”，丢失后无法找回。</p><div id="account-status"></div><div id="account-forms"><div class="form-grid"><label>昵称<input id="display-name" maxlength="30" value="古籍读者"></label><button id="register" class="primary-button">创建我的书架</button></div><hr><div class="form-grid"><label>书架编号<input id="reader-code" autocomplete="username"></label><label>恢复码<input id="recovery-code" type="password" autocomplete="current-password"></label><button id="login" class="secondary-button">登录已有书架</button></div></div><div id="account-result" class="notice" hidden></div></section></div>`;
const accountScript = `<script>(()=>{const {api,AUTH}=window.HusirApi,result=document.querySelector('#account-result'),forms=document.querySelector('#account-forms'),status=document.querySelector('#account-status');const show=m=>{result.hidden=false;result.innerHTML=m};api('/api/account/status').then(r=>r.json()).then(data=>{if(data.authenticated){localStorage.setItem(AUTH,'1');forms.hidden=true;status.innerHTML='<p>欢迎回来，<b>'+data.displayName+'</b>（'+data.readerCode+'）</p><button id="logout" class="secondary-button">退出登录</button>';document.querySelector('#logout').onclick=()=>api('/api/account/logout',{method:'POST'}).then(()=>{localStorage.removeItem(AUTH);location.reload()})}else localStorage.removeItem(AUTH)});document.querySelector('#register').onclick=()=>api('/api/account/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:document.querySelector('#display-name').value})}).then(async r=>({ok:r.ok,data:await r.json()})).then(({ok,data})=>{if(!ok)return show(data.error);localStorage.setItem(AUTH,'1');show('<b>注册成功，请立即保存：</b><br>书架编号：<code>'+data.readerCode+'</code><br>恢复码：<code>'+data.recoveryCode+'</code>')});document.querySelector('#login').onclick=()=>api('/api/account/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readerCode:document.querySelector('#reader-code').value,recoveryCode:document.querySelector('#recovery-code').value})}).then(async r=>({ok:r.ok,data:await r.json()})).then(({ok,data})=>{if(!ok)return show(data.error);localStorage.setItem(AUTH,'1');location.reload()})})();</script>`;
write("account/index.html", page({ title: "读者登录", description: "虎思国学网书架账户", path: "/account/", body: accountBody, script: accountScript }));

const shelfBody = `<div class="page-shell">${crumbs([{ label: "我的书架" }])}<section class="museum-bar"><h1>我的书架</h1><p>未登录也可使用，记录只保存在当前浏览器；登录后可跨设备同步。</p><a class="primary-button" href="/account/">登录或注册</a></section><section class="panel"><h2>收藏典籍</h2><div id="favorite-list" class="chapter-list"></div><p id="favorite-empty">暂无收藏，从典籍卡片点击“收藏”即可加入。</p></section><section class="panel"><h2>最近阅读</h2><div id="history-list" class="chapter-list"></div><p id="history-empty">还没有阅读记录。</p></section></div>`;
const shelfScript = `<script>(()=>{const {api,AUTH,FAVORITES,HISTORY,read,write}=window.HusirApi,favorites=read(FAVORITES),history=read(HISTORY);const render=(id,empty,rows,href,label)=>{const box=document.getElementById(id);box.replaceChildren(...rows.map(row=>{const a=document.createElement('a');a.href=href(row);a.textContent=label(row);return a}));document.getElementById(empty).hidden=rows.length>0};const done=()=>{render('favorite-list','favorite-empty',favorites,x=>'/'+x.slug+'/',x=>'《'+x.title+'》');render('history-list','history-empty',history.slice(0,30),x=>x.path,x=>(x.workTitle||'典籍')+' · '+x.title)};if(localStorage.getItem(AUTH)==='1')api('/api/bookshelf').then(r=>r.ok?r.json():null).then(remote=>{if(!remote)return;remote.favorites.forEach(x=>{if(!favorites.some(y=>y.slug===x.work_slug))favorites.push({slug:x.work_slug,title:x.work_title})});remote.history.forEach(x=>{if(!history.some(y=>y.path===x.chapter_path))history.push({path:x.chapter_path,workTitle:x.work_title,title:x.chapter_title})});write(FAVORITES,favorites);write(HISTORY,history)}).finally(done);else done()})();</script>`;
write("bookshelf/index.html", page({ title: "我的书架", description: "查看收藏的典籍与最近阅读记录", path: "/bookshelf/", body: shelfBody, script: shelfScript }));

const css = `${readFileSync(join(project, "src/styles/global.css"), "utf8")}\n${readFileSync(join(project, "src/styles/search.css"), "utf8")}\n.admin-stats{margin-top:12px}.admin-stats .panel{margin-top:0}.auth-panel{max-width:760px;margin:12px auto}.reader-content img{height:auto}.reader-content table{max-width:100%}`;
write("site.css", css);
copyFileSync(join(project, "static-assets/app.js"), join(target, "app.js"));
for (const asset of ["logo.svg", "favicon.svg", "favicon.ico", "cover-placeholder.svg"]) copyFileSync(join(project, "public", asset), join(target, asset));
write("catalog-search.json", JSON.stringify(catalog.works.map((work) => ({ slug: work.slug, title: work.title, author: work.author, dynasty: work.dynasty, introduction: work.introduction, description: work.description, cover: work.cover, chapterCount: work.chapterCount, search: [work.title, work.author, work.dynasty, work.introduction, work.description].join(" ").toLowerCase() }))));
write(".nojekyll", "");
write("CNAME", "husir.cn\n");

const overrides = await loadD1Overrides();
const overrideSummary = overrides.length ? applyD1Overrides(target, overrides) : null;
console.log(JSON.stringify({ departments: catalog.departments.length, works: catalog.works.length, generatedChapters, skippedChapters, overrides: overrideSummary, target }));
