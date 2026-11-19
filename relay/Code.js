/* 웅천고 도서관 구입 도우미 — 중계(독서로·알라딘)
   브라우저는 독서로·알라딘에 바로 물을 수 없어서(CORS) 이 스크립트가 대신 묻고 결과만 돌려준다.
   개인정보를 받지도 저장하지도 않는다. 받는 것은 책 제목·지은이·ISBN·검색어뿐. */
var NEIS = 'S100000673', PROV = 'S10', SCHOOL = '웅천고등학교', LIB = 'https://read365.edunet.net';

function doGet(e) { return route_((e && e.parameter) || {}); }
function doPost(e) {
  var p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) {}
  return route_(p);
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function route_(p) {
  try {
    if (p.a === 'ping') return out_({ ok: true, school: SCHOOL, at: new Date().toISOString() });
    if (p.a === 'hold') return out_({ ok: true, list: hold_(p.items || JSON.parse(p.q || '[]')) });
    if (p.a === 'search') return out_({ ok: true, list: search_(String(p.q || '')) });
    if (p.a === 'item') return out_({ ok: true, item: item_(String(p.id || '')) });
    if (p.a === 'count') return out_({ ok: true, count: count_() });
    if (p.a === 'items') return out_({ ok: true, list: items_(p.ids || []) });
    if (p.a === 'find') return out_({ ok: true, list: find_(p.qs || []) });
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) { return out_({ ok: false, error: String(err).slice(0, 300) }); }
}

/* ---------- 같은 책 고르기(웅천서가 read365.ts 와 같은 규칙) ---------- */
function S_(v) { return v == null ? '' : String(v).trim(); }
function norm_(s) { return S_(s).replace(/[\s·,.'"“”‘’\-–—()\[\]:;!?『』「」<>~]/g, '').toLowerCase(); }
function core_(t) { return norm_(S_(t).replace(/^\s*[(\[][^)\]]*[)\]]\s*/, '').split(/\s*[:=]\s*/)[0].replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '')); }
function authorOk_(ours, theirs) {
  var toks = S_(ours).split(/[\s,.·;]+/).filter(function (x) { return x.length >= 2 && !/^(지음|옮김|지은이|글|그림|엮음|외)$/.test(x); });
  if (!toks.length) return true;
  var th = norm_(theirs);
  return toks.some(function (t) { return th.indexOf(norm_(t)) >= 0; });
}
function libSearchReq_(kw) {
  return { url: LIB + '/alpasq/api/search', method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    headers: { Accept: 'application/json' },
    payload: JSON.stringify({ searchKeyword: kw, page: 1, display: 50, neisCode: [NEIS], provCode: PROV, schoolName: SCHOOL, coverYn: 'N' }) };
}
function libData_(r) {
  try { if (r.getResponseCode() !== 200) return null; var d = JSON.parse(r.getContentText()); return d && d.status === 'OK' ? d.data : null; } catch (e) { return null; }
}
/** items: [{t, a, isbn}] (최대 80) → [{found, how, callNo, title, n}] */
function hold_(items) {
  items = (items || []).slice(0, 80);
  var cache = CacheService.getScriptCache(), res = new Array(items.length), reqs = [], who = [];
  items.forEach(function (it, i) {
    var key = 'h1|' + norm_(it.isbn) + '|' + core_(it.t) + '|' + norm_(it.a).slice(0, 10);
    key = key.slice(0, 240);
    var c = cache.get(key);
    if (c) { res[i] = JSON.parse(c); return; }
    var kws = [];
    var isbn = S_(it.isbn).replace(/[^0-9X]/gi, '');
    if (isbn.length >= 10) kws.push(isbn);
    var t = S_(it.t).replace(/^\s*[(\[][^)\]]*[)\]]\s*/, '').split(/\s*[:=]\s*/)[0].replace(/\s*\([^)]*\)\s*$/, '');
    if (t) kws.push(t);
    kws.forEach(function (k) { reqs.push(libSearchReq_(k)); who.push([i, k === isbn ? 'isbn' : 'title', key]); });
  });
  var resp = [];
  for (var s = 0; s < reqs.length; s += 25) resp = resp.concat(UrlFetchApp.fetchAll(reqs.slice(s, s + 25)));
  var acc = {};
  resp.forEach(function (r, k) {
    var i = who[k][0], kind = who[k][1], d = libData_(r), it = items[i];
    var a = acc[i] || (acc[i] = { ok: false, found: false, how: '', callNo: '', title: '', n: 0, key: who[k][2] });
    if (!d) return;
    a.ok = true;
    var list = d.bookList || [];
    var want = core_(it.t), isbn = S_(it.isbn).replace(/[^0-9X]/gi, '');
    list.forEach(function (b) {
      var bi = S_(b.isbn).replace(/[^0-9X]/gi, ''), ct = core_(b.title), how = '';
      if (isbn && bi && (bi === isbn || bi.slice(0, 13) === isbn)) how = '같은 판';
      else if (want && ct === want && authorOk_(it.a, b.author)) how = '같은 제목·지은이';
      else if (want && ct.indexOf(want) === 0 && /^\d+$/.test(ct.slice(want.length)) && authorOk_(it.a, b.author)) how = '다른 권';
      if (!how) return;
      if (!a.found || (a.how !== '같은 판' && how === '같은 판') || (a.how === '다른 권' && how !== '다른 권')) {
        a.found = true; a.how = how; a.callNo = S_(b.callNo).replace(/\s+c\.\s*\d+$/, ''); a.title = S_(b.title) + ' · ' + S_(b.author);
      }
      a.n++;
    });
  });
  items.forEach(function (it, i) {
    if (res[i]) return;
    var a = acc[i];
    if (!a) { res[i] = { ok: false }; return; }
    res[i] = { ok: a.ok, found: a.found, how: a.how, callNo: a.callNo, title: a.title, n: a.n };
    if (a.ok) try { cache.put(a.key, JSON.stringify(res[i]), 3 * 3600); } catch (e) {}
  });
  return res;
}
/** 우리 학교 장서 권수(대분류 합) — 연결 확인용 */
function count_() {
  var r = UrlFetchApp.fetch(LIB + '/alpasq/api/category/list?type=B', { muteHttpExceptions: true });
  var d = libData_(r); if (!d) return null;
  var codes = (d.categoryList || []).map(function (x) { return S_(x.lCategoryCode); }).filter(String);
  var reqs = codes.map(function (c) {
    return { url: LIB + '/alpasq/api/search', method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
      payload: JSON.stringify({ categoryCode: c, lCode: c.slice(0, 3) + '000000', page: 1, display: 1, neisCode: [NEIS], provCode: PROV, schoolName: SCHOOL, coverYn: 'N' }) };
  });
  var n = 0;
  UrlFetchApp.fetchAll(reqs).forEach(function (r) { var x = libData_(r); if (x) n += Number(x.totalCount) || 0; });
  return n;
}

/* ---------- 알라딘(가격·분류) ---------- */
function aget_(u) {
  var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  return r.getResponseCode() === 200 ? r.getContentText('UTF-8') : '';
}
function strip_(s) { return S_(String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')); }
function parseList_(h) {
  var outL = [];
  String(h).split('class="ss_book_box"').slice(1).forEach(function (p) {
    var id = (p.match(/^\s*itemId="(\d+)"/) || [])[1];
    var tm = p.match(/class="bo3">([^<]+)<\/a>(?:<span class="ss_f_g2"> - ([^<]+)<\/span>)?/);
    if (!id || !tm) return;
    var li = p.match(/<li>((?:<a href="\/Search\/wSearchResult\.aspx\?AuthorSearch[\s\S]*?))<\/li>/), au = '', pub = '', date = '';
    if (li) { var seg = li[1].split(' | '); au = strip_(seg[0]); pub = strip_(seg[1] || ''); date = strip_(seg[2] || ''); }
    var price = (p.match(/<span class="">([\d,]+)<\/span>원/) || [])[1];
    var sp = (p.match(/세일즈포인트 :<span class="sales_point">\s*([\d,]+)/) || [])[1];
    var cover = (p.match(/class="front_cover"[^>]*src="([^"]+)"/) || p.match(/<img src="([^"]+cover[^"]+)"[^>]*class="front_cover"/) || [])[1] || '';
    if (!cover) cover = (p.match(/src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]+cover[^"]+)"/) || [])[1] || '';
    outL.push({ id: id, t: strip_(tm[1]), sub: strip_(tm[2] || ''), a: au, p: pub, date: date,
      price: price ? Number(price.replace(/,/g, '')) : null, sp: sp ? Number(sp.replace(/,/g, '')) : 0,
      cover: cover, out: /절판|품절/.test(p.slice(0, 4000)) });
  });
  return outL;
}
function search_(q) {
  q = S_(q).slice(0, 80); if (!q) return [];
  var cache = CacheService.getScriptCache(), key = 's1|' + norm_(q).slice(0, 200), c = cache.get(key);
  if (c) return JSON.parse(c);
  var L = parseList_(aget_('https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=' + encodeURIComponent(q))).slice(0, 15);
  try { cache.put(key, JSON.stringify(L), 6 * 3600); } catch (e) {}
  return L;
}
function item_(id) {
  if (!/^\d+$/.test(id)) return null;
  var h = aget_('https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=' + id); if (!h) return null;
  var ul = h.indexOf('id="ulCategory"'), cats = [];
  if (ul >= 0) cats = h.slice(ul, h.indexOf('</ul>', ul)).split('<li').slice(1).map(function (li) { return strip_(li.replace(/<a href="javascript[\s\S]*$/, '')).replace(/^>?\s*국내도서\s*>\s*/, '').replace(/\s+/g, ' '); }).filter(String);
  return { id: id, isbn: (h.match(/books:isbn" content="(\d+)"/) || [])[1] || '', cats: cats,
    adult: /19세 미만 구독불가|adult_19/.test(h), date: (h.match(/itemprop="datePublished" content="([\d-]+)"/) || [])[1] || '',
    cover: (h.match(/og:image" content="([^"]+)"/) || [])[1] || '' };
}

/** 처음 한 번 편집기에서 실행해 외부 요청 권한을 승인하는 용도 */
function setup() { Logger.log(JSON.stringify(hold_([{ t: '아몬드', a: '손원평', isbn: '' }]))); Logger.log(count_()); }


/** 여러 권 분류·ISBN(최대 25) */
function items_(ids) {
  ids = (ids || []).filter(function (x) { return /^\d+$/.test(String(x)); }).slice(0, 25);
  var rs = UrlFetchApp.fetchAll(ids.map(function (id) { return { url: 'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=' + id, muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36' } }; }));
  return rs.map(function (r, i) {
    if (r.getResponseCode() !== 200) return null;
    var h = r.getContentText('UTF-8'); if (h.indexOf('ulCategory') < 0) return null;
    var ul = h.indexOf('id="ulCategory"');
    var cats = h.slice(ul, h.indexOf('</ul>', ul)).split('<li').slice(1).map(function (li) { return strip_(li.replace(/<a href="javascript[\s\S]*$/, '')).replace(/^>?\s*국내도서\s*>\s*/, '').replace(/\s+/g, ' '); }).filter(String);
    var price = (h.match(/정가<\/div>[\s\S]{0,300}?([\d,]{4,})원/) || [])[1];
    return { id: String(ids[i]), isbn: (h.match(/books:isbn" content="(\d+)"/) || [])[1] || '', cats: cats, adult: /19세 미만 구독불가|adult_19/.test(h),
      date: (h.match(/itemprop="datePublished" content="([\d-]+)"/) || [])[1] || '', cover: (h.match(/og:image" content="([^"]+)"/) || [])[1] || '',
      price: price ? Number(price.replace(/,/g, '')) : null, pages: (h.match(/(\d+)쪽/) || [])[1] || '' };
  });
}
/** 여러 검색어의 첫 결과 목록(최대 20) */
function find_(qs) {
  qs = (qs || []).slice(0, 20);
  var rs = UrlFetchApp.fetchAll(qs.map(function (q) { return { url: 'https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=' + encodeURIComponent(String(q).slice(0, 80)), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36' } }; }));
  return rs.map(function (r) { return r.getResponseCode() === 200 ? parseList_(r.getContentText('UTF-8')).slice(0, 5) : null; });
}


