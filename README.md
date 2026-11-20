# Pip the Sugar Glider: desktop pet 🐾

A friendly 3D sugar glider that lives on your desktop, outside any browser. It hops and glides around your screen, follows your cursor with its eyes, and chats when you click it.

## Run it

You need [Node.js](https://nodejs.org) (version 18 or newer) installed once.

```
cd pip-desktop
npm install
npm start
```

Pip appears at the bottom-right of your screen. A tray/menu-bar icon appears too.

## Use

- **Click Pip** to chat. **Drag Pip** anywhere; it glides back down to the bottom of the screen when you let go.
- **Right-click Pip** (or use the tray icon) for the menu: chat, hide, stay still, launch at login, **Quit**.
- Chat shortcuts: Help me decide, Flip a coin, Fun fact, **What I copied** (summarizes or explains whatever text is on your clipboard), Cheer me up.
- Pip walks, hops, and sometimes does a long glide across the desktop. It only blocks clicks where Pip itself is; everything else on your screen works normally.

## Pip as a general helper

Pip isn't just for chit-chat: ask it to write or fix code in any language, explain things, do homework or maths, draft and edit writing, plan, or brainstorm. Chit-chat stays short; real tasks get full answers. Code appears in dark code blocks with a **Copy** button, the ⤢ button makes the chat window bigger, and you can ask Pip to type code into your editor or save it as a new file in your chosen folder (each after you approve). For code and harder questions, pick **Sonnet** (or **Opus**) as the Brain in ⚙ settings; Haiku is fastest and cheapest.

## Letting Pip do things (always asks first)

Pip can now help with almost anything on your computer. **Every single action shows up as a card in the chat with exactly what it will do, and only happens after you click Approve.** Decline works too, and an unanswered card expires after 2 minutes. Risky actions (commands, key presses, closing apps, replacing files, anything outside your work folder) show in **red** with the exact command or path.

**Always available (when "Let Pip do things for me" is on):**
- **Control Panel and Settings:** "open the control panel", "open Wi-Fi settings", "where do I uninstall apps?", "open Device Manager". Pip opens the right window (Windows Control Panel, Settings pages, Device Manager, Services, Task Manager and more; System Settings on macOS; GNOME/KDE settings on Linux). It only opens the window, you make the changes.
- **Type for you:** after you approve, you get 5 seconds to click the exact spot where the text should go, then Pip pastes it there. (Your clipboard is restored afterwards.)
- **Look at your screen:** "what's the answer to this question?" Pip takes one picture of your main screen (Pip and the chat hide first), reads it, and answers. Never saved.
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
- Pip can't click with the mouse; it uses commands, keys and settings pages instead. For harder jobs pick **Sonnet** or **Opus** as the Brain in ⚙ settings; Haiku is fastest and cheapest.

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
- **Groq (free, no card):** click **Get a free key** (opens console.groq.com), sign up with an email, create a key (it starts with `gsk_`), paste it, and pick a model (default `llama-3.3-70b-versatile`; `llama-3.1-8b-instant` is faster with higher free limits). The key is stored encrypted on your computer and only sent to Groq. These models read text only, so "look at my screen" won't work; use Gemini or Claude for that. What Pip sends goes to Groq, so don't use it for private things.
- **Anthropic Claude (paid):** paste an Anthropic API key. It's stored encrypted and only sent to api.anthropic.com. Usage is billed to your Anthropic account; Haiku is the cheapest. Claude is the stronger choice for multi-step computer tasks.

Both keys are kept separately, so you can switch providers any time without pasting again. Hopping, cursor-following and coin flips work without any key.

Settings also let you rename Pip, change fur colour (grey-blue, honey, cocoa), and toggle wandering, nudges and launch at login.

## Build a normal installer (optional)

```
npm run dist
```

This makes an installer for the OS you run it on (Windows .exe, macOS .dmg, Linux AppImage) in the `dist` folder.

## Notes

- Pip lives on your main display only.
- Transparent windows need a compositing desktop. Windows and macOS are fine; on Linux it works on most modern desktops (GNOME, KDE) but not on every setup.
- If the tray icon does not show on your Linux desktop, right-click Pip to quit.
