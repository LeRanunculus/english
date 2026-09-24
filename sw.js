/* ⚠️ 이 파일은 **_학습장생성.py --pwa 가 생성한다.** 여기를 직접 고치지 말고
   `_pwa템플릿/sw.js` 를 고친 뒤 다시 빌드할 것.

   캐시 버전은 **빌드가 자동으로 올린다.** 손으로 올리게 두면 언젠가 빠뜨리고,
   그러면 고쳐도 폰에는 옛 화면이 그대로 뜬다 — "고쳤는데 왜 안 바뀌지"의 99%가 이것이다.
   내용(화면·음성 목록·manifest·이 파일)이 한 글자라도 바뀌면 숫자가 오른다.
   화면 위쪽 칩에 이 값이 그대로 나오므로 폰에서 눈으로 확인할 수 있다. */
const CACHE = "english-v16";

/* ⚠️⚠️ 음성은 **버전과 무관한 별도 캐시**에 둔다 (2026-09-19).
   아래 activate 는 CACHE 가 아닌 캐시를 전부 지운다. 음성을 versioned 캐시에 넣으면
   회차를 빌드할 때마다(= 화면이 바뀔 때마다) 버전이 오르고 **13.6MB 를 매번 다시 받는다.**
   파일 이름이 내용 해시(e668ba028af1.mp3)라 낡을 일이 없으므로 버전을 따를 이유가 없다. */
const AUDIO = "english-audio";
const ISAUDIO = u => u.pathname.indexOf("/audio/") >= 0;

/* 전부 상대경로다. Pages 는 /english/ 서브경로로 서비스되므로
   "/index.html" 처럼 절대경로를 쓰면 404 가 난다.

   ⚠️ 음성 mp3 730여개는 여기 넣지 않는다. install 의 waitUntil 에 730개 fetch 를 매달면
      설치가 길어져 브라우저가 중간에 끊을 수 있고, 그러면 **껍데기조차 캐시에 안 남는다.**
      음성은 페이지가 활성화 뒤에 24개씩 끊어 받아 **같은 캐시**에 넣는다(index.html 의 precache).
      진행률이 화면에 보이므로 "받아졌는지"를 추측하지 않아도 된다. */
const ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    // 하나가 실패해도 나머지는 캐싱한다. all-or-nothing 이면 설치 자체가 실패한다
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      /* ⚠️ `k !== CACHE` 로만 거르면 음성 캐시까지 날아간다. 옛 **버전 캐시만** 지운다. */
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== AUDIO && k.indexOf("english-v") === 0)
                                .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* network-first + 2초 타임아웃 → 캐시.
   신호가 "없는" 것보다 "약한" 것이 나쁘다. 완전 오프라인이면 fetch 가 즉시 실패해
   캐시로 넘어가지만, 신호가 1칸이면 요청이 10초 넘게 매달렸다가 실패한다.
   헬스장 지하에서 앱을 열 때마다 그만큼 흰 화면을 본다.
   cache-first 로 하지 않는 이유는 고쳐도 옛 화면이 계속 뜨기 때문이다. */
const TIMEOUT = 2000;

function fromNetwork(req) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
    fetch(req).then(res => {
      clearTimeout(t);
      // 성공한 GET 만 캐시에 갱신해 둔다
      if (res && res.ok && req.method === "GET") {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      resolve(res);
    }, err => { clearTimeout(t); reject(err); });
  });
}

/* ⚠ `hit || caches.match(...) || new Response(...)` 로 쓰지 말 것.
   caches.match() 는 Promise 를 반환하고 Promise 는 언제나 truthy 라 뒤의 503 은
   절대 평가되지 않는다. 그 Promise 가 undefined 로 resolve 되면 — install 이
   allSettled 라 index.html 이 캐시에 없을 수 있다 — respondWith(undefined) 가
   TypeError 로 죽어서 오프라인에서 앱이 아예 안 열린다. 반드시 await 로 푼다. */
async function fromCache(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  // 문서 요청이면 앱 껍데기라도 돌려준다
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    const shell = (await caches.match("index.html")) || (await caches.match("./"));
    if (shell) return shell;
  }
  return new Response("오프라인이고 캐시에도 없습니다.", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       // 저장은 전부 로컬이라 GET 만 다룬다
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 외부 요청은 없다 (원칙 1)

  /* 음성은 **cache-first**. 이름이 내용 해시라 낡지 않으므로 네트워크를 볼 이유가 없고,
     ▶ 를 누른 뒤 2초 타임아웃을 기다리는 일도 없앤다. */
  if (ISAUDIO(url)) {
    e.respondWith((async () => {
      const c = await caches.open(AUDIO);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    })().catch(() => new Response("", { status: 504 })));
    return;
  }

  /* 비행기 모드처럼 확실히 오프라인이면 네트워크를 아예 시도하지 않는다.
     실측 결과 연결이 끊긴 상태에서도 fetch 가 즉시 실패하지 않고 2초 타임아웃을 다 썼다.
     그러면 오프라인으로 열 때마다 2초를 기다리게 된다.
     신호가 "약한" 경우(onLine 은 true)는 그대로 타임아웃 경로를 탄다 — 그게 원래 의도다. */
  if (self.navigator && self.navigator.onLine === false) {
    e.respondWith(fromCache(req));
    return;
  }
  e.respondWith(fromNetwork(req).catch(() => fromCache(req)));
});

// 캐시 버전을 화면에 띄우기 위해 페이지가 물어본다 (함정 ③을 폰에서 눈으로 확인)
self.addEventListener("message", e => {
  if (e.data !== "version") return;
  const reply = { cache: CACHE };
  if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
  else if (e.source) e.source.postMessage(reply);
});
