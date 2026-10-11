# Kronika 9:16 – demo

Aplikacja zamienia temat w pionowy short zmontowany z archiwalnych zdjęć. W trybie automatycznym wystarczy wpisać temat: system sam znajduje zdjęcia w archiwum, pisze i weryfikuje scenariusz, nagrywa lektora i montuje MP4. Kreator krok po kroku pozwala zrobić to samo z ręcznymi poprawkami.

## Uruchomienie

Wymagania: Node 22.9+, pnpm, ffmpeg z libass, macOS (zapasowy lektor to systemowy głos Zosia).

```bash
pnpm install
pnpm build          # paczka render + API
pnpm api            # NestJS na http://localhost:4000
pnpm web            # Next.js na http://localhost:3000
```

Scenariusz pisze model językowy. API wybiera go według zmiennych środowiskowych:

| Ustawienie | Kto pisze scenariusz |
|---|---|
| `ANTHROPIC_API_KEY=...` | Claude przez API (ścieżka docelowa, jeszcze nieuruchamiana z prawdziwym kluczem) |
| `KRONIKA_WRITER=cli` | Lokalnie zainstalowany Claude Code (`claude -p`), tryb deweloperski bez klucza |
| brak obu | Przygotowane pliki z `samples/` albo same opisy archiwalne |

Przykład: `KRONIKA_WRITER=cli pnpm api`.

Zmienne można też zapisać w pliku `.env` w katalogu głównym: skopiuj `.env.example` do `.env` i uzupełnij. API wczytuje go przy starcie (`pnpm api` i tryb `dev`), a zmienne ustawione w powłoce mają pierwszeństwo.

`pnpm fetch:archive` pobiera ponownie zdjęcia i opisy z Wikimedia Commons według `data/seed-titles.json`.
`pnpm sample` renderuje film z pliku `samples/gdynia.script.json` bez udziału API.

## Skąd bierze się fabuła

- Fakty pochodzą z dłuższego tekstu o temacie: artykułu polskiej Wikipedii (do 10 000 znaków, bez przypisów). Podpisy zdjęć same nie wystarczają na opowieść.
- Model najpierw wypisuje trzy możliwe kąty opowieści, wybiera ten z największym napięciem i pisze jedną historię: ktoś czegoś chce, pojawia się przeszkoda, następuje zwrot, na końcu skutek.
- Obrazy dobierane są do gotowych zdań, a nie odwrotnie. Zdjęcie ilustruje zdanie, ale nie musi być jego źródłem.
- Weryfikacja działa tak samo jak wcześniej, tylko względem tekstu źródłowego lub opisu obrazu: dosłowny cytat, liczby i nazwy własne.
- Plansza końcowa i opis filmu podają źródło tekstu z licencją (CC BY-SA 4.0) obok źródeł obrazów.

## Jak system walczy o uwagę widza

- Hook stoi na ekranie w całości od pierwszej klatki i otwiera pytanie, na które odpowiada dopiero ostatnie zdanie o faktach; puenta wraca do hooka, żeby film zapętlał się naturalnie.
- Model wybiera rodzaj hooka: nawiązanie do trendu, luka w wiedzy, konkretny szczegół, kontrast „wtedy i dziś” albo pytanie do widza.
- Trendy to najczęściej czytane wczoraj hasła polskiej Wikipedii (otwarte API). Model używa trendu tylko wtedy, gdy ma prawdziwy związek z tematem, pomija hasła o zmarłych, tragediach, przestępstwach i politykach i niczego nie twierdzi o popularnej osobie.
- Weryfikacja pozwala w hooku na nazwę spoza opisów wyłącznie wtedy, gdy jest to hasło z listy trendów; w przeciwnym razie film dostaje hook zapasowy.

## Formaty i różnorodność

- Formaty (style Brainrot i Storytime): `pov` (widz w środku wydarzeń, hook od „POV:”), `aura` (żartobliwa punktacja faktów jako naklejki i suma na końcu), `zgadnij` (wskazówki bez podpisów źródeł, odliczanie 3-2-1, odpowiedź) i `klasyczny`. Format wybiera użytkownik albo jest losowany.
- Przy tematach o wojnie, śmierci, chorobie, zbrodni lub cudzej krzywdzie instrukcja każe modelowi wybrać format klasyczny.
- Punkty aury są tylko na ekranie: lektor ich nie czyta i nie podlegają weryfikacji, bo nie są faktem.
- Każdy film losuje wygląd z ziarna opartego na scenariuszu: kolor akcentu, kolejność ujęć, kolor błysku na cięciach, wjazd karty z boku i podkład. Ten sam scenariusz daje zawsze ten sam film.
- Ruch: drgnięcie kadru przy stemplu z rokiem, naklejce i odpowiedzi zagadki; efekty dźwiękowe generowane w ffmpeg (nieodsłuchane).
- W formacie `zgadnij` odpowiedź może zdradzić sam obraz, np. rycina z podpisem; system tego nie wykrywa.

## Co jest w środku

| Katalog | Zawartość |
|---|---|
| `packages/render` | Kontrakt storyboardu, lektor zdanie po zdaniu, napisy ASS, montaż w ffmpeg: kilka ujęć na zdanie, stemple z rokiem, podkład |
| `apps/api` | `/auto`, `/search`, `/script`, `/verify`, `/render`, `/jobs/{id}`; wyszukiwanie na żywo w Wikimedia Commons, model piszący scenariusz, własna weryfikacja zdań |
| `apps/web` | Ekran startowy z trybem automatycznym i kreator z pięcioma ekranami |
| `assets/manifest.json` | Szablony stylów; nowy styl to wpis w tym pliku |
| `data/objects.json` | 23 ręcznie zebrane obiekty w domenie publicznej w trzech tematach |
| `data/objects.live.json` | Obiekty pobrane z archiwum w trakcie działania |
| `data/docs/` | Pobrane teksty źródłowe |
| `samples/*.script.json` | Scenariusze zapasowe, w każdym jedno zdanie bez pokrycia |

## Czego demo jeszcze nie robi

- Wyszukiwanie w zbiorze lokalnym jest leksykalne (wspólne rdzenie słów), bez embeddingów.
- Weryfikacja sprawdza cytat, liczby i nazwy własne. Nie ocenia, czy zdanie wynika z cytatu znaczeniowo, a przy długim tekście źródłowym sprawdzenie nazw jest słabsze.
- Podpis na kadrze pokazuje datę zdjęcia, która może różnić się od roku, o którym mówi lektor.
- Lektor to systemowy głos, a czasy słów są szacowane z długości słów.
- Podkład rytmiczny jest generowany w ffmpeg i nie był odsłuchany; układ z rozgrywką w dolnej połowie działa po wskazaniu własnego nagrania w manifeście (`layout: "split"`, `background`).
- Nie ma filtra tematów drażliwych: archiwum zawiera też zdjęcia wojenne, do których styl Brainrot nie pasuje, a pomijanie drażliwych trendów zależy tylko od instrukcji dla modelu.

## Pomiary (Intel i9, bez karty graficznej)

| Film | Długość | Czas |
|---|---|---|
| Gdynia, Brainrot, sam montaż | 26 s | 28 s |
| Gdynia, Kronika, sam montaż | 26 s | 38 s |
| Warszawa, Brainrot, lektor + montaż przez API | 27 s | 42 s |
| Zakopane, Brainrot, tryb automatyczny od samego tematu | 35 s | 104 s |

Tryb automatyczny dla Zakopanego: archiwum 18 s, scenariusz 28 s, lektor 13 s, montaż 36 s. Pomiary powyżej pochodzą sprzed przebudowy montażu; nowy montaż tego samego filmu trwa 57 s.
