# Pip the Sugar Glider: desktop pet 🐾

A realistic 3D sugar glider that lives on your desktop, outside any browser. It hops, flies up to wherever it is needed and perches on a branch, follows your cursor with its eyes, and chats when you click it.

## Run it

You need [Node.js](https://nodejs.org) (version 18 or newer) installed once.

```
cd pip-desktop
npm install
npm start
```

Pip appears at the bottom-right of your screen. A tray/menu-bar icon appears too.

## Use

- **Fling Pip** (let go while moving the mouse fast) and he really tumbles: he spins, bounces off the walls and ceiling and rolls on the floor. After a moment of panic he spreads his membrane, rights himself and glides down to a skidding landing. Repeated hard knocks keep him tumbling and leave him dizzy.
- **Click Pip** to chat. **Drag Pip** anywhere (he spreads his gliding membrane while you carry him). Drop him up in the air and a branch grows under him so he stays there for a good while; drop him near the floor and he settles down.
- **Right-click Pip** (or use the tray icon) for the menu: chat, hide, stay still, launch at login, **Quit**.
- Chat shortcuts: Help me decide, Flip a coin, Fun fact, **What I copied** (summarizes or explains whatever text is on your clipboard), Cheer me up.
- Pip hops around the floor. When he is needed somewhere (see below) he crouches, launches, glides there with his membrane stretched out, and a leafy branch grows for him to land on and sit. After a while, or when you drag him, the branch shrinks away and he glides home.
- At rest his gliding membrane is tucked against his sides, like a real sugar glider's.
- Pip only blocks clicks where he is himself; everything else on your screen works normally.

## Pip as a general helper

Pip isn't just for chit-chat: ask it to write or fix code in any language, explain things, do homework or maths, draft and edit writing, plan, or brainstorm. Chit-chat stays short; real tasks get full answers. Code appears in dark code blocks with a **Copy** button, the ⤢ button makes the chat window bigger, and you can ask Pip to type code into your editor or save it as a new file in your chosen folder (each after you approve). For code and harder questions, pick **Sonnet** (or **Opus**) as the Brain in ⚙ settings; Haiku is fastest and cheapest.

## Tell Pip to move

Pip can control its own body from the chat, with no approval card because it touches nothing else on your computer. Try: "hop three times", "dance" (a fresh routine every time, to the beat), "do the disco", "wave hello", "come here" (he flies to your cursor and perches there), "go to the left", "go to the middle", "stay there", "go back to wandering". Moving his own body works even if you switch off "do things on my computer" in settings. For help with things on screen see **Pip sees buttons without a screenshot** below.

## Pip acts, he doesn't just talk

Say what you want and Pip does it instead of pasting a link or giving you steps:

- **Sites by name:** "open YouTube", "go to Netflix", "pull up Gmail", "open reddit". `open_url` understands plain site names (see `SITES` in `system.js`) as well as full addresses. Well-known sites open with no card.
- **Search or play inside a site:** "play lofi on YouTube" opens the top video; "search keyboards on Amazon", "pizza near me on maps", "look up Ada Lovelace on Wikipedia" (`search_site`: YouTube, Google, Images, Maps, Amazon, Wikipedia, GitHub, Stack Overflow, Reddit, Spotify, Twitch, IMDb, DuckDuckGo, Bing).
- **Volume and music, no card:** "turn it up", "mute", "set the volume to 30", "pause the music", "skip this song" (`media_control`). Play/pause/next/previous control Spotify and Apple Music on macOS, any media player on Windows, and `playerctl` players on Linux. A video playing in a browser tab needs a click or a key press.
- **Apps by friendly name:** "open VS Code", "open Word", "open Spotify". Browsers and a few harmless apps (Calculator, Notepad, Spotify, Finder...) open with no card; everything else still asks first (`open_app`).
- **Multi-step jobs:** "open Notepad and write my shopping list" opens the app, then types into it.
- **Browser controls:** "new tab", "next tab", "go to tab 3", "go back", "refresh", "close this tab", "bring that tab back", "search on this page" (`browser`). Pip flies up to the top bar and uses the browser's own shortcuts on the window in front. Everything is automatic except **closing a tab**, which asks first (and can be undone with reopen). To open a website use "open YouTube" style requests: they already open in a new tab.
- **Stop:** while Pip is working there is a red **Stop** button next to Send, and **Esc** works too. If Pip has hidden the chat to type or press something, use the tray / right-click menu item **Stop what Pip is doing** or the shortcut **Ctrl/Cmd+Alt+X**. It cancels the request, declines any open approval cards and tells you. A step that is already running (like a command) finishes, but nothing after it happens. While Pip works, the typing bubble shows **step N: what he is doing**, and after step 8 it reminds you about Stop.
- **Scrolling:** "scroll down", "keep scrolling", "go to the bottom", "back to the top" (`scroll`, no card). Pip flies to the edge of the screen and presses Page Up/Down or Home/End on the window in front, so the page you mean must be the one in front. Say "scroll down and tell me what it says" and he looks at the screen afterwards. It can only scroll: nothing can be typed or clicked this way. macOS needs the Accessibility permission, Linux needs `xdotool`.
- **He acts it out:** to open a page Pip flies up to the browser's top bar ("opening a new tab up here..."), to open an app he flies down to the taskbar/dock, he hops when he changes the volume or skips a song (dances for play/pause), and he cheers when it worked. This is automatic and only moves Pip himself.
- **A safety net:** if Pip answers an "open / play / search / mute..." request with a link or "you can click..." instead of using a tool, the app sends it back once and tells it to do the job. If you really want the link, ask for the link.
- If "Let Pip do things for me" is switched **off** in settings, Pip now says so instead of pasting links.

## Pip sees buttons without a screenshot

Pip can read where the buttons, boxes, links and menus are straight from your operating system's accessibility information (the same data screen readers use). No picture is taken, nothing you typed into a box is read, and password boxes are skipped. Try: "press Save for me", "type hello into the search box", "where's the Share button?".

- **find_ui** reads the names and positions of what is in the front window (approve once per look). Pip's own window is ignored.
- **press_ui** flies Pip next to the item, then presses it (or ticks it, or puts the cursor in it) using accessibility controls, not the mouse. Every press shows a card with the item's name, and names like Delete, Send, Pay or Install show in red.
- **No card for quick typing:** tick **Let Pip type short one-line things without asking** in ⚙ settings (or the tray menu) and things like "search up cats on YouTube" are typed straight away: Pip flies to the search box, types and presses Enter, and tells you what he typed. Text over 300 characters, multi-line text and code still ask, and he never auto-types into a terminal or password box. "Search up X" with no app named just opens a Google search.
- **type_text** now flies to the text box that has your cursor and types there, so you no longer have to click within 5 seconds. If no box is found, the window is a terminal, or the app shares nothing, it falls back to the old "click the spot" countdown.
- Some apps (games, remote desktops, some canvas apps) share nothing. Pip then falls back to **Look at your screen**.
- **Windows:** nothing to set up. **macOS:** needs the Accessibility permission (the same one typing needs); very busy windows such as web browsers can be slow to read. **Linux:** needs `python3-gi` and `gir1.2-atspi-2.0`, and apps must expose accessibility.

## Safe browsing (no approval needed)

Pip opens a few things without a card because they only show you a page: `https` links to a short allowlist of well-known sites (Wikipedia, DuckDuckGo, Google, YouTube, GitHub, Stack Overflow, MDN and a few more, see `SAFE_HOSTS` in `actions.js`), and plain browsers by name (Chrome, Firefox, Edge, Safari, Brave, Opera). Look-alike domains, other ports, links with a login in them and plain `http` still ask first. Edit the lists in `actions.js` to suit you.

## Letting Pip do things (always asks first)

Pip can now help with almost anything on your computer. **Every single action shows up as a card in the chat with exactly what it will do, and only happens after you click Approve.** Decline works too, and an unanswered card expires after 2 minutes. Risky actions (commands, key presses, closing apps, replacing files, anything outside your work folder) show in **red** with the exact command or path.

**Always available (when "Let Pip do things for me" is on):**
- **Control Panel and Settings:** "open the control panel", "open Wi-Fi settings", "where do I uninstall apps?", "open Device Manager". Pip opens the right window (Windows Control Panel, Settings pages, Device Manager, Services, Task Manager and more; System Settings on macOS; GNOME/KDE settings on Linux). It only opens the window, you make the changes.
- **Type for you:** works in search bars, forms, documents and chats. After you approve (you see the exact text), you get 5 seconds to click the exact spot where the text should go, then Pip pastes it there. (Your clipboard is restored afterwards.) If you want a search submitted, Pip can press Enter too, and the card says so. Pip can't click the box for you.
- **Look at your screen:** "what's the answer to this question?" Pip takes one picture of your main screen (Pip and the chat hide first), reads it, and answers. Never saved. It asks each time unless you tick **Let Pip look at my screen without asking each time** in ⚙ settings (or in the tray / right-click menu). That switch covers looking only (the picture and the button finder); pressing, typing and everything else still asks. The picture is kept small (1280 px) so it is quick to send.
- **Read the web:** Pip can download and read a public web page (or a search results page) to look something up. Public sites only; it never reaches into your own network or local services. Or it can open a page on screen.
- **Calendar:** search it (read only), add an event (opens in your default calendar app and you click Save), or set a reminder ("remind me in 20 minutes").
- **Clipboard, open apps, see what's running, system info** (OS, memory, free disk space).
- **Open files and folders** with their default app, or show them in the file manager. It will not launch programs or scripts that way.

**Full access (on by default; switch it off in ⚙ settings):**
- **Run commands** (PowerShell on Windows, zsh on macOS, sh on Linux): change volume or dark mode, check disk or network, install or list software, run git or scripts, and so on. You see the exact command first. Commands can't use sudo/admin or passwords, can't download-and-run code, can't switch off security protection, can't wipe drives, and can't touch password or key folders.
- **Press keys / shortcuts** in the app you're using (like Ctrl+S or F5), after a short countdown so you can click the right window.
- **Close apps** politely, like clicking their X.
- **Files anywhere**, not just one folder: list, read, save, move, rename, create folders, and Trash. Pip never changes system folders (Windows, Program Files, /System, /usr...), password or key folders (.ssh, .aws...), or its own settings. Replacing a file sends the old version to the Trash first, and deleting always means the Trash. (One exception: a *command* that deletes does not use the Trash, so Pip is told to prefer its Trash tool and the card warns you.)

Things to know:
- Pip is an AI and can misunderstand (smaller or free models more so). **Read each card before approving**, especially red ones. The built-in blocklist catches the worst mistakes, but your click is the real safety.
- Text from files, web pages, screenshots or command output is treated as data. If something tries to boss Pip around, Pip is told to mention it to you instead of obeying.
- Command output, file contents and screenshots you approve are sent to whichever AI provider you picked (Anthropic, Google or Groq) so Pip can read them.
- Pip never moves your mouse; it presses things through accessibility controls, commands, keys and settings pages instead. For harder jobs pick **Sonnet** or **Opus** as the Brain in ⚙ settings; Haiku is fastest and cheapest.

Setup notes:
- **macOS:** typing and key presses need Accessibility permission (System Settings > Privacy & Security > Accessibility). macOS will prompt the first time.
- **Linux:** typing and key presses need `xdotool` and work on X11 only, not Wayland.
- **Windows:** the Windows key itself can't be pressed by Pip (use the settings pages or a command instead).
- Try it: "open the control panel", "make my screen night mode", "what's using my disk space?", "remind me to stretch in 30 minutes", "sort my Downloads into folders by file type", "look up the opening hours of the library".

Run `npm test` to check Pip's safety rules and tools (no real changes are made to your computer).

## Connect a calendar

In ⚙ settings, under **Calendars**, add one or more:

- **A calendar link:** Google Calendar: Settings > your calendar > "Secret address in iCal format". Outlook.com: Settings > Calendar > Shared calendars > Publish > ICS link. Paste it and click Add link. Pip checks it right away and tells you how many events it found. Links are stored encrypted, because a secret address is like a password.
- **A .ics file:** export from any calendar app, then "Add .ics file...". (A file is a snapshot, so re-add it after big changes.)
- **macOS only:** tick "Also search the Calendar app on this Mac". This searches by name (great for birthdays) and covers iCloud and any accounts you added to Calendar. macOS asks once for permission (Privacy & Security > Automation).

Notes: Google's automatic "Birthdays" calendar (built from contacts) usually has no iCal link, so birthdays only show up if they are real events in a calendar you connected. Leap-day (Feb 29) birthdays show on Feb 28 in other years. Very unusual repeat patterns can be approximate, and Pip says so.

## Screen permission

- **macOS:** the first look asks for Screen Recording permission (System Settings > Privacy & Security > Screen Recording). After you allow it, quit and reopen Pip. If you run it with `npm start`, the permission may be listed under Electron or your terminal.
- **Windows:** nothing to set up.
- **Linux:** works on X11 and desktops that allow screen capture; some Wayland setups block it.

## Make it talk (pick a brain)

Click the ⚙ in the chat panel and choose an **AI brain provider**:

- **Google Gemini (free tier available):** click **Get a free key** (opens Google AI Studio), sign in, create a key, paste it, and pick a model (default `gemini-2.5-flash`; `gemini-2.5-flash-lite` is lighter if you hit the limits). The key is stored encrypted on your computer and only sent to Google.
  - **Free limits are small.** If Google says you've hit the limit, Pip waits and retries a couple of times, then tells you; wait a minute or switch to a lighter model. Very long jobs can pause.
  - **Privacy:** on Google's free tier, Google may use what Pip sends (your chats, plus anything you approve sharing, like screenshots, files and command output) to improve its products, and human reviewers may read it. Don't use the free tier for private things. If you turn on billing for the key's Google project, Google's paid terms apply instead and your data isn't used that way. Approval cards on Gemini remind you who receives what. (Gemini's API also requires you to be 18+, and in the EU, UK and Switzerland only paid use is allowed.)
  - Model names change over time. If Google rejects the name, type a current one from aistudio.google.com into the model box.
- **Groq (free, no card):** click **Get a free key** (opens console.groq.com), sign up with an email, create a key (it starts with `gsk_`), paste it, and pick a model (default `openai/gpt-oss-120b`; `openai/gpt-oss-20b` is faster). The key is stored encrypted on your computer and only sent to Groq. These models read text only, so "look at my screen" won't work; use Gemini, Cloudflare or Claude for that. What Pip sends goes to Groq, so don't use it for private things.
- **Cloudflare Workers AI (free, no card, can see your screen):** click **Get a free key** (opens your Cloudflare API tokens page), sign up, and create a token from the **Workers AI** template. Also paste your **Account ID** (shown in the Cloudflare dashboard: the long ID in the address after you log in, or on the Workers AI page). Pick a model (default `@cf/google/gemma-4-26b-a4b-it`, which reads pictures and can use tools, so \"look at my screen\" works). The token is stored encrypted on your computer and only sent to Cloudflare. The free allowance is 10,000 neurons a day; very large models (like `@cf/moonshotai/kimi-k2.6`) use it up much faster. What Pip sends, including screenshots you approve, goes to Cloudflare, so don't use it for private things.
- **A model on this computer (Ollama or LM Studio, fully private):** pick this provider, press **Find my models**, choose one. Nothing goes online: the address has to be on this computer (`localhost` / `127.0.0.1`), chats, files and clipboard text stay here, and Pip never falls back to an online service if the local one is off. It reads text only (no "look at my screen"), and it needs a model that supports tool calling to do things for you (small models make more mistakes, so read each approval card).
- **Anthropic Claude (paid):** paste an Anthropic API key. It's stored encrypted and only sent to api.anthropic.com. Usage is billed to your Anthropic account; Haiku is the cheapest. Claude is the stronger choice for multi-step computer tasks.

All keys are kept separately, so you can switch providers any time without pasting again. Hopping, cursor-following and coin flips work without any key.

Settings also let you rename Pip, change fur colour (natural grey, honey, cocoa), and toggle wandering, nudges and launch at login.

## Talk to Pip (voice chat)

Tap the 🎤 button next to the chat box and just talk. Pip listens until you stop talking (or tap the mic again), turns what you said into text, and answers like a normal chat message. If you tap the mic while Pip is talking, it stops and listens.

- **Who hears you:** in ⚙ > *Voice chat*, pick Cloudflare (Whisper), Groq (Whisper) or Google Gemini. "Same as my AI brain" works when your chat brain is one of those three. Anthropic can't turn speech into text, so Claude users pick one of the other three (you need that company's key; Cloudflare also needs your Account ID). Cloudflare's speech model costs a tiny fraction of your free daily allowance.
- **Privacy:** Pip never listens in the background. The mic only turns on after you tap it (the button goes red, and your system's mic light shows too), and it turns off when the clip ends. One short recording (up to 60 seconds, kept only in memory, never saved) is sent to the company you picked. Free tiers can have different data rules from paid ones: on Google's free tier, Google may review what it gets.
- **Pip talks back:** ⚙ > *Pip talks back*: after you talked to it (default), always, or never. Spoken replies use your computer's own voices, so nothing is sent anywhere for that. Code, links and emoji are skipped, and long answers are shortened ("the rest is in the chat"). On some Linux systems there are no voices installed, so Pip stays silent.
- **Everything else still works by voice:** "what's on my screen?", "open Wi-Fi settings", "remind me in 20 minutes". Anything that touches your computer still asks for approval first.
- **Permissions:** macOS asks for Microphone access the first time (System Settings > Privacy & Security > Microphone; if you run it with `npm start`, it may be listed under Electron or your terminal). On Windows, make sure *Settings > Privacy > Microphone* allows desktop apps. Pip's window can use the microphone and nothing else (no camera).

## Build a normal installer (optional)

```
npm run dist
```

This makes an installer for the OS you run it on (Windows .exe, macOS .dmg, Linux AppImage) in the `dist` folder.

## Notes

- Pip lives on your main display only.
- Transparent windows need a compositing desktop. Windows and macOS are fine; on Linux it works on most modern desktops (GNOME, KDE) but not on every setup.
- If the tray icon does not show on your Linux desktop, right-click Pip to quit.

## Routines, memory, voice shortcut, auto-press
- **Routines**: "set up a morning routine with Gmail and the news" saves a list of sites; "do my morning routine" opens them all. Safe sites open without a card; any other site makes the routine ask once.
- **Memory**: "remember my usual browser is Firefox" saves a short note (max 30) that Pip sees in every chat. "Forget that" removes it. Stored in `memory.json` in the app's data folder.
- **Voice shortcut**: Ctrl/Cmd+Alt+Space starts listening, press again to finish (can be switched off in settings).
- **Press ordinary buttons without asking**: opt-in setting; Delete, Send, Pay, Install and similar still ask.

## Morning brief, quick clipboard buttons, activity log

- **Morning brief:** say "morning brief" or "my day" (or tap **My day**, or use the tray menu) for today's calendar events, tasks and weather. Pip also mentions a one-line version in his first morning greeting. Weather is optional: type a city in Settings > General and Pip asks Open-Meteo (free, no account); only the city name is sent, and nothing is looked up while the box is empty.
- **Clipboard buttons:** when you copy a chunk of text, small buttons (Summarize, Explain, Fix writing, Translate; or Explain / Find bugs for code) appear next to Pip for ten seconds. Pip only reads the clipboard to decide whether it is worth offering (never for links or password-like words, at most once a minute) and again when you press a button. Switch it off in Settings > General.
- **What Pip did (Settings > Activity, or the tray menu):** the last 50 things Pip did, with the exact command or path shown and a Copy button. **Undo** works for files Pip moved, created, replaced or trashed (Pip keeps a private copy for 30 days, up to 500 MB, in its own data folder), and for volume and tabs. Typed text and file contents are never written to the log. Say "undo" in chat to reverse the latest one.

## Connected tools (MCP)

Settings > Connected tools lets you add programs that give Pip new abilities over the Model Context Protocol (stdio servers, for example `npx -y @modelcontextprotocol/server-memory`). Only you can add one, in settings; the AI cannot. A connected tool runs on your computer with your permissions, so Pip shows an approval card with the exact arguments for **every** use and never skips it. What a tool returns is labelled as data from an outside program, and images are left out. A server gets only a small set of environment variables plus the secrets you typed for it (kept in a private file), never Pip's own keys, and its requests for Pip to do things for it (sampling and so on) are refused.

## Games
Say "play Wordle", "do today's Connections", "play Krillion", "solve this sudoku" or "play chess against me". Pip asks once, then for that one request looks at the screen, types, clicks and drags without asking each time. It ends when the game is over, at the step limit, or when you press Stop.

Pip gets a **playbook** for the game when it starts (see `games.js`): Wordle and clones, Connections, Spelling Bee, crosswords and the Mini, Strands, Sudoku, 2048, Minesweeper, board games, trivia and quiz games, memory and word-search games, plus a general one for anything new. Tools for games: `game_keys` (typing and arrow keys), `click_many` (several clicks in one call), `drag_screen` (press, move along a path, release), `chess_play` (a full chess game), `sudoku_solve` (exact solver). Each of these sends back a screenshot, so no separate look is needed. Real-time action games, ranked play, money and accounts are excluded. Dragging uses the OS mouse events: it needs `xdotool` on Linux and the Accessibility permission on macOS. For trivia and harder puzzles choose **Sonnet** in settings.

**Games window:** tap **Play a game with Pip** in the chat panel for offline games against Pip: chess, checkers, Connect Four, tic-tac-toe, Gomoku (five in a row), Hangman, Battleship and Dots and Boxes. Use the strength slider to make Pip easier or harder.

**Chess feels more like a friend (v1.21):** Pip gets bored if you think for more than about 40 seconds (a comment, a yawn, a second one much later), glances at the board and drifts to a perch beside it while you think (never onto the board, and he never touches your mouse), plays looser when rushed and sharper on long thinks (with the odd slip in quiet positions), teases a quick blunder, notices a very fast or very slow opponent, gives a short recap after the game, and remembers your win/loss record across games.

**Blunder and brilliant sliders (v1.22):** Settings has "Blunders per game" (0 to 8) and "Brilliant moves per game" (0 to 5), each with an Auto tick box (Auto = what the strength setting gives). Each game draws its own count around your average and spreads it over the game. Blunders are overlooks: an attacked piece left hanging, a piece put where it is taken, a capture not seen. They never happen in the opening, while in check, or with hardly any choice. A brilliant needs a real sacrifice that works, so that number is "up to". The sliders apply when Pip plays on a real board; the small Games window keeps its own style and strength pickers.

## Automatic updates (GitHub)
1. Put this project in a GitHub repo and set `repository.url` in `package.json` to it.
2. Bump `version` in `package.json`, commit, then push a tag: `git tag v1.20.1 && git push --tags`.
3. The workflow in `.github/workflows/release.yml` builds the installers and publishes them (plus the `latest.yml` update files) to a GitHub Release.
4. Installed copies of Pip check for updates at start and every 4 hours, download in the background, and install on the next close.
Windows and Linux update fully on their own. macOS needs a signed app for silent updates, so there Pip only tells you a new version exists.

## Voice
- Ctrl/Cmd+Alt+Space: talk to Pip in the chat. Ctrl/Cmd+Alt+D: dictate into any app (fillers removed, "comma", "new line", "scratch that" work).
- Pip's spoken voice uses Gemini, Cloudflare or Groq neural voices (same key as hearing); it falls back to the computer's voice.


**Mouse fidgeting (v1.23):** While you think, Pip can move the real mouse like a person: rest it over a piece, wander to another, try a move in the air, wiggle a little. It never clicks, hands the cursor back where it found it, only starts once your mouse has been still for a few seconds, and stops for 30 seconds if you grab it. Turn it off in Settings > Chess ("Pip fidgets with the mouse while I think").

**Resigns and rematches (v1.23.1):** Pip now notices when a result pop-up covers the board (the opponent resigned, a flag fell, a draw was agreed), says so, counts the win when he was clearly ahead, and stops instead of waiting minutes for a move. He never clicks through a pop-up. Rematch now presses your taught Play again / New game button, waits for the new pieces to be set up, and works out his colour from which side is at the bottom (sites swap colours). A slow opponent (over 90 s) no longer crashes the move loop, and in chat games Pip checks the screen after about 90 s of silence, because sites like Lichess show "resigned" beside the board, not over it. Tip: teach the Play again button once (chess teach) for hands-free rematches.

**Chess, round two (v1.23.2):**
- **Resignations with no pop-up (Lichess style):** Pip watches the area around the board. If clocks were ticking and then everything stands still for 20 seconds on the opponent's turn, he decides the game has ended, just like with a pop-up.
- **Learns the Play again button:** if he has to wait while you start the next game by hand, he remembers where your mouse was and presses it himself next time (fix it any time with chess teach).
- **Matchmaking guard:** if his first move will not register because the site is still looking for an opponent, he waits up to a minute for the game to begin instead of giving up.
- **Resign and draw buttons in chat games:** new `chess_press` tool (resign, draw, play_again, new_game) uses the buttons you taught. Two new teachable buttons: Offer draw and Draw confirm. When Pip offers a draw and they decline, he plays on and does not ask again; if they accept he notices and records the draw.
- **Remembers across restarts:** the last board, which seat Pip played and the taught buttons are saved per board position on the screen (`chess-profiles.json`), so Rematch and chess auto work after a restart and different sites keep their own buttons.

**Languages and offline tricks (v1.24):** pick a language in settings (Auto, English, Español, Français, Deutsch, Português, Italiano). Without any AI, Pip understands the basics in those languages: greetings, the time and date, jokes and facts, "open", "search", volume, music, timers and reminders. With an AI key he answers everything in the chosen language. New offline tricks in `lang.js`: strong passwords ("generate a password"), "pick pizza, tacos or sushi", "15% of 80", reverse, upper and lower case, word and letter counts, palindromes, hex to rgb, random colour, days between two dates, roman numerals, base64.

**Sugar glider radar:** see settings. Off by default. Reads window titles for "sugar glider" (no picture) and, with an Anthropic, Gemini or Cloudflare key, watches for screen changes locally and asks the AI to look.
