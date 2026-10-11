"use client";

import { useEffect, useRef, useState } from "react";
import { API, ArchiveObject, Job, Sentence, StyleId, get, post } from "./api";

const SUGGESTIONS = ["Gdynia i jej port", "Warszawa nad Wisłą", "Wystawa Krajowa w Poznaniu"];

const STYLES: { id: StyleId; name: string; tone: string; split: boolean }[] = [
  { id: "kronika", name: "Kronika", tone: "Poważny, pełny kadr, ziarno filmowe", split: false },
  { id: "storytime", name: "Storytime", tone: "Potoczny, pełny kadr, duże napisy", split: false },
  { id: "brainrot", name: "Brainrot", tone: "Podzielony ekran z rozgrywką", split: true },
];

const FORMATS = [
  { id: "losowy", name: "Losowy format" },
  { id: "aura", name: "Aura" },
  { id: "pov", name: "POV" },
  { id: "zgadnij", name: "Zgadnij" },
  { id: "klasyczny", name: "Klasyczny" },
];

const STEPS = ["Temat", "Materiały", "Styl", "Scenariusz", "Film"];

export default function Page() {
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [objects, setObjects] = useState<ArchiveObject[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [style, setStyle] = useState<StyleId>("brainrot");
  const [format, setFormat] = useState("losowy");
  const [origin, setOrigin] = useState("");
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [rejected, setRejected] = useState<Sentence[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coś poszło nie tak");
    } finally {
      setBusy(false);
    }
  }

  const search = (value: string) => guard(async () => {
    setTopic(value);
    const { objects: hits } = await post<{ objects: ArchiveObject[] }>("/search", { topic: value });
    if (!hits.length) throw new Error("W archiwum nie ma obiektów pasujących do tego tematu.");
    setObjects(hits);
    setSelected(hits.slice(0, 6).map((o) => o.id));
    setStep(1);
  });

  const writeScript = () => guard(async () => {
    const data = await post<{ origin: string; scenes: Sentence[]; rejected: Sentence[] }>("/script", { topic, asset_ids: selected, style, format });
    setOrigin(data.origin);
    setSentences(data.scenes);
    setRejected(data.rejected);
    setStep(3);
  });

  const reverify = () => guard(async () => {
    const { verdicts } = await post<{ verdicts: Sentence[] }>("/verify", { sentences });
    setSentences(verdicts);
  });

  const generate = () => guard(async () => {
    const started = await post<Job>("/render", {
      topic,
      style,
      scenes: sentences.map(({ text, source_quote, asset_id, kind, trend, doc_id, sticker, countdown, hide_chip }) => ({ text, source_quote, asset_id, kind, trend, doc_id, sticker, countdown, hide_chip })),
    });
    follow(started);
  });

  const auto = (value: string) => guard(async () => {
    setTopic(value);
    setSentences([]);
    follow(await post<Job>("/auto", { topic: value, style, format }));
  });

  function follow(started: Job) {
    if (poll.current) clearInterval(poll.current);
    setJob(started);
    setStep(4);
    if (started.status !== "running") return;
    poll.current = setInterval(async () => {
      const next = await get<Job>(`/jobs/${started.id}`).catch(() => null);
      if (!next) return;
      setJob(next);
      if (next.status !== "running" && poll.current) clearInterval(poll.current);
    }, 1000);
  }

  async function download() {
    if (!job?.video_url) return;
    const blob = await (await fetch(`${API}${job.video_url}`)).blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `kronika-${job.id}.mp4`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  const byId = (id: string) => objects.find((o) => o.id === id);
  const allOk = sentences.length > 0 && sentences.every((s) => s.ok);
  const spoken = job?.report?.scenes ?? sentences;
  const title = spoken[0]?.text ?? topic;
  const credits = job?.storyboard?.credits ?? [];
  const description = [
    `${topic}. Każde zdanie w tym filmie ma cytat ze wskazanego źródła.`,
    "",
    "Źródła:",
    ...(job?.storyboard?.text_sources ?? []).map((t) => `Tekst: ${t.source}, „${t.title}” (${t.license}): ${t.url}`),
    ...credits.map((c) => `${c.title}${c.license.startsWith("CC BY") && c.author ? `, fot. ${c.author}` : ""} (${c.license}): ${c.url}`),
    "",
    "#historia #archiwum #shorts",
  ].join("\n");

  return (
    <main>
      <header>
        <button className="brand" onClick={() => { if (poll.current) clearInterval(poll.current); setStep(0); setJob(null); }}>
          KRONIKA <span>9:16</span>
        </button>
        <ol className="steps">
          {STEPS.map((name, i) => (
            <li key={name} className={i === step ? "active" : i < step ? "done" : ""}>{name}</li>
          ))}
        </ol>
      </header>

      {error && <p className="error">{error}</p>}

      {step === 0 && (
        <section className="start">
          <h1>O czym ma być short?</h1>
          <p className="lead">Wpisz temat. System sam znajdzie materiały w archiwum, napisze i sprawdzi scenariusz, a potem zmontuje film.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (topic.trim()) auto(topic); }}>
            <input autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="np. Zakopane, Kraków, tramwaje, Gdynia" />
            <button className="primary" disabled={busy || !topic.trim()}>Zrób shorta</button>
          </form>
          <div className="chips">
            {STYLES.map((s) => (
              <button key={s.id} className={style === s.id ? "on" : ""} onClick={() => setStyle(s.id)}>{s.name}</button>
            ))}
          </div>
          {style !== "kronika" && (
            <div className="chips formats">
              {FORMATS.map((f) => (
                <button key={f.id} className={format === f.id ? "on" : ""} onClick={() => setFormat(f.id)}>{f.name}</button>
              ))}
            </div>
          )}
          <p className="hint">Gotowe tematy:</p>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => auto(s)} disabled={busy}>{s}</button>
            ))}
          </div>
          <button className="link" disabled={busy || !topic.trim()} onClick={() => search(topic)}>
            Wolę wybrać materiały i poprawić scenariusz ręcznie
          </button>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2>Materiały do tematu „{topic}”</h2>
          <p className="lead">Zaznaczone obiekty trafią do filmu. Wybrano {selected.length} z {objects.length}.</p>
          <div className="grid">
            {objects.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button key={o.id} className={`card ${on ? "on" : ""}`} onClick={() => setSelected(on ? selected.filter((id) => id !== o.id) : [...selected, o.id])}>
                  <img src={`${API}${o.thumb}`} alt="" />
                  <span className="check">{on ? "✓" : ""}</span>
                  <strong>{o.description.replace(/^Tytuł : /, "").slice(0, 90)}</strong>
                  <small>{[o.date, o.source, o.license].filter(Boolean).join(" · ")}</small>
                </button>
              );
            })}
          </div>
          <footer>
            <button onClick={() => setStep(0)}>Wstecz</button>
            <button className="primary" disabled={selected.length < 3} onClick={() => setStep(2)}>Dalej</button>
          </footer>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>Styl montażu</h2>
          <p className="lead">Styl zmienia formę filmu. Fakty przechodzą tę samą weryfikację w każdym stylu.</p>
          <div className="styles">
            {STYLES.map((s) => (
              <button key={s.id} className={`style ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}>
                <div className={`mock ${s.id}`}>
                  <div className="photo" />
                  {s.split && <div className="game" />}
                  <span className="cap">NAPIS</span>
                </div>
                <strong>{s.name}</strong>
                <small>{s.tone}</small>
              </button>
            ))}
          </div>
          <footer>
            <button onClick={() => setStep(1)}>Wstecz</button>
            <button className="primary" disabled={busy} onClick={writeScript}>{busy ? "Piszę scenariusz…" : "Napisz scenariusz"}</button>
          </footer>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>Scenariusz z weryfikacją</h2>
          <p className="lead">
            Źródło szkicu: {origin}. Każde zdanie możesz poprawić; po zmianie przechodzi weryfikację jeszcze raz.
          </p>
          <ul className="script">
            {sentences.map((s, i) => (
              <li key={i} className={s.ok ? "ok" : "bad"}>
                <img src={`${API}/files/archive/${s.asset_id}.jpg`} alt="" />
                <div>
                  <input
                    value={s.text}
                    onChange={(e) => setSentences(sentences.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    onBlur={reverify}
                  />
                  {s.ok ? (
                    <p className="quote">
                      <span className="badge">✓ {s.kind === "fact" ? "ma pokrycie" : s.kind === "hook" ? "hook" : "puenta"}</span>
                      {s.source_quote ? <>„{s.source_quote}” <em>{byId(s.asset_id)?.date}</em></> : s.trend ? `Nawiązanie do popularnego hasła „${s.trend}”.` : "Zdanie ramowe: bez liczb i nazw spoza źródeł."}
                    </p>
                  ) : (
                    <p className="quote"><span className="badge">✕ zablokowane</span>{s.reason}</p>
                  )}
                </div>
              </li>
            ))}
            {rejected.map((s, i) => (
              <li key={`r${i}`} className="rejected">
                <img src={`${API}/files/archive/${s.asset_id}.jpg`} alt="" />
                <div>
                  <p className="struck">{s.text}</p>
                  <p className="quote"><span className="badge">usunięte</span>{s.reason}</p>
                </div>
              </li>
            ))}
          </ul>
          <footer>
            <button onClick={() => setStep(2)}>Wstecz</button>
            <button className="primary" disabled={busy || !allOk} onClick={generate}>Generuj wideo</button>
          </footer>
        </section>
      )}

      {step === 4 && job && (
        <section className="result">
          <div className="phone">
            {job.status === "done" && job.video_url ? (
              <video src={`${API}${job.video_url}`} controls autoPlay playsInline loop />
            ) : (
              <div className="waiting">{job.status === "error" ? "Błąd" : `${Math.round(job.progress * 100)}%`}</div>
            )}
          </div>
          <div className="side">
            {job.status === "running" && (
              <>
                <h2>Powstaje film</h2>
                <div className="bar"><div style={{ width: `${job.progress * 100}%` }} /></div>
                <ol className="stages">
                  {job.stages.map((name, i) => {
                    const current = job.stages.indexOf(job.stage);
                    return <li key={name} className={i < current ? "done" : i === current ? "active" : ""}>{name}</li>;
                  })}
                </ol>
              </>
            )}
            {job.status === "error" && (
              <>
                <h2>Nie udało się wygenerować filmu</h2>
                <p className="error">{job.error}</p>
                <button onClick={() => setStep(sentences.length ? 3 : 0)}>Wróć</button>
              </>
            )}
            {job.status === "done" && (
              <>
                <h2>Film gotowy</h2>
                <p className="lead">
                  {job.cached ? "Wynik z pamięci podręcznej." : `Wygenerowano w ${job.seconds} s.`} Długość lektora: {job.storyboard?.duration.toFixed(1)} s.
                </p>
                <button className="primary" onClick={download}>Pobierz MP4</button>
                <label>Tytuł</label>
                <div className="copy">
                  <p>{title}</p>
                  <button onClick={() => copy("title", title)}>{copied === "title" ? "Skopiowano" : "Kopiuj"}</button>
                </div>
                <label>Opis ze źródłami</label>
                <div className="copy">
                  <pre>{description}</pre>
                  <button onClick={() => copy("desc", description)}>{copied === "desc" ? "Skopiowano" : "Kopiuj"}</button>
                </div>
                <button onClick={() => setStep(sentences.length ? 2 : 0)}>{sentences.length ? "Zmień styl" : "Nowy film"}</button>
              </>
            )}
            {job.report && (
              <>
                <label>Co system zrobił sam</label>
                <p className="lead">
                  Obrazy: {job.report.materials}. {job.report.text_source && <>Fakty: {job.report.text_source}. </>}Scenariusz: {job.report.script}.
                  {job.report.format && <> Format: {job.report.format}.</>}
                  {job.report.angle && <> Kąt opowieści: {job.report.angle}</>}
                  {job.report.hook_type && <> Hook: {job.report.hook_type}{job.report.trend ? `, nawiązanie do popularnego hasła „${job.report.trend}”` : ""}.</>}
                </p>
                <ul className="script compact">
                  {job.report.scenes.map((s, i) => (
                    <li key={i} className="ok">
                      <div>
                        <p className="line">{s.text}{s.sticker && <span className={`aura ${s.sticker.tone}`}>{s.sticker.text}</span>}</p>
                        {s.source_quote && <p className="quote">„{s.source_quote}”</p>}
                      </div>
                    </li>
                  ))}
                  {job.report.rejected.map((s, i) => (
                    <li key={`r${i}`} className="rejected">
                      <div>
                        <p className="struck">{s.text}</p>
                        <p className="quote"><span className="badge">usunięte</span>{s.reason}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
