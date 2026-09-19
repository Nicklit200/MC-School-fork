# Testing the online classroom — for testers

You need **two laptops**: one is the teacher, one is the student.

**Only ONE of you needs to set anything up.** The other just opens a link.

---

## Who does what

| | Person A ("the host") | Person B ("the student") |
|---|---|---|
| Installs anything | yes | **no** |
| Needs a LiveKit account | yes (free, 5 min) | **no** |
| What they do | runs the app, plays the teacher | opens a URL in a browser |

Person B needs nothing but a browser. All credentials live on Person A's
machine.

---

# Person A — setup (~20 minutes, once)

## 1. Install

- **Docker Desktop** — https://docker.com
- **Java 17 or newer** — `java -version`
- **Node.js 20 or newer** — `node --version`

## 2. Get the code

```bash
git clone <repository-url>
cd MC-School
```

## 3. Get free LiveKit credentials

1. Sign up at **https://cloud.livekit.io** (free tier is plenty).
2. Create a project.
3. Open **Settings → Keys** and copy three things:
   - **Project URL** — looks like `wss://something.livekit.cloud`
   - **API Key**
   - **API Secret**

Keep them handy. They never leave your machine.

## 4. Start it — three terminals

**Terminal 1 — database**

```bash
cd backend
docker compose up -d
```

> If you see `Bind for 0.0.0.0:5434 failed`, that port is taken. Use:
> ```bash
> docker run -d --name mcschool-pg -e POSTGRES_USER=myuser \
>   -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb -p 5439:5432 postgres:16-alpine
> ```
> and add `DB_PORT=5439` to the next command.

**Terminal 2 — backend** (paste your three LiveKit values)

```bash
cd backend
ADMIN_EMAIL=admin@mcschool.local \
ADMIN_PASSWORD='ChangeMe123!' \
ONLINE_CLASSES_ENABLED=true \
ONLINE_CLASS_ALLOW_TEST_CLASSES=true \
LIVEKIT_URL='wss://YOUR-PROJECT.livekit.cloud' \
LIVEKIT_API_KEY='YOUR_KEY' \
LIVEKIT_API_SECRET='YOUR_SECRET' \
./mvnw spring-boot:run
```

Wait for `Started FlashcardApplication`, and check the log says:

```
Online classes: LiveKit media provider active
```

If it says *unconfigured*, one of the three LiveKit values is wrong or missing.

**Terminal 3 — frontend**

```bash
cd frontend
npm ci
npm run dev
```

## 5. Create the test accounts and a class

**Terminal 4:**

```bash
./scripts/seed-local.sh
```

It prints something like:

```
TEACHER   maria@mcschool.local / TeacherPass123!
STUDENT   sam@mcschool.local   / StudentPass123!

Test class: http://localhost:5173/online-classes/53ebc9bb-...
```

**Write those down.** Person B needs the student login.

## 6. Make it reachable from the other laptop

Browsers **refuse** camera and microphone on a plain `http://192.168.x.x`
address. So you cannot just share your local IP. Use a tunnel:

```bash
npx ngrok http 5173
```

It prints a URL like `https://a1b2c3.ngrok-free.app`. **Send that to Person B**,
plus the student login.

> If the app doesn't load for Person B, also tunnel the backend
> (`npx ngrok http 8080`) and rebuild the frontend pointing at it. Ask the
> developer if you hit this.

---

# Person B — nothing to install

1. Open the `https://...ngrok-free.app` link Person A sent you.
2. Log in with the **student** account.
3. Go to **Online classes** in the menu.
4. Allow camera and microphone when the browser asks.

That's it.

---

# The test — work through this together

Person A is the **teacher**, Person B is the **student**.

> Wear headphones, or mute one laptop, or you'll get feedback squeal.

## Joining

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 1 | **A:** open the class link, allow camera/mic | you see yourself | ☐ |
| 2 | **B:** open the class, allow camera/mic | says "waiting for the teacher" | ☐ |
| 3 | **B:** reload the page | still waiting — doesn't lose its place | ☐ |
| 4 | **A:** click **Admit** next to the student's name | student enters | ☐ |
| 5 | Both | you can **see and hear each other** | ☐ |

## Devices and screen

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 6 | Both: turn camera off, then on | video stops and comes back | ☐ |
| 7 | Both: mute, then unmute | audio stops and comes back | ☐ |
| 8 | **A:** share your screen | B sees your screen; your camera moves to a small tile | ☐ |
| 9 | **A:** stop sharing | back to normal view | ☐ |

## Chat

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 10 | Both: send a few messages | appear on both sides quickly | ☐ |
| 11 | **Both: reload the page** | **all messages still there, not doubled** | ☐ |
| 12 | **B:** send ~15 messages fast | eventually says "too many messages, wait" | ☐ |

## Connection drop

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 13 | **B:** turn Wi-Fi off ~10 seconds, back on | shows "reconnecting", then recovers **on its own** | ☐ |
| 14 | After reconnecting | video, audio and chat all work again | ☐ |

## Teacher controls

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 15 | **A:** mute the student | B's mic goes off, B can see they're muted | ☐ |
| 16 | **A:** click "ask to unmute" | B gets a **request** — B is NOT switched on automatically | ☐ |
| 17 | **A:** remove the student | B is disconnected | ☐ |
| 18 | **B:** try to rejoin | **cannot get back in** | ☐ |

*(Re-admit B before continuing: B reloads and asks to join again, A admits.)*

## Whiteboard

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 19 | Both: open the whiteboard, draw | each sees the other's drawing | ☐ |
| 20 | Both: click **Undo** | removes only **your own** last stroke, not theirs | ☐ |
| 21 | **A:** click **Clear all**, confirm | board clears for both | ☐ |
| 22 | **B:** reload, reopen the whiteboard | earlier drawing is still there | ☐ |

## Ending

| # | Do this | Should happen | OK? |
|---|---|---|---|
| 23 | **A:** click **End class for everyone**, confirm | both leave the room | ☐ |
| 24 | Both: check your laptop | **camera light is off** | ☐ |
| 25 | **A:** open the lesson page again | attendance shows roughly how long each person was in | ☐ |

---

# Phone or tablet (optional)

If someone has an iPad or Android phone, have **B** join from it instead, using
the same link.

| # | Check | OK? |
|---|---|---|
| 26 | Camera and mic work | ☐ |
| 27 | Buttons are big enough to tap | ☐ |
| 28 | Rotate to landscape — controls still reachable | ☐ |
| 29 | Drawing on the whiteboard with a finger doesn't scroll the page | ☐ |

---

# Reporting problems

For anything that fails, note:

1. **Step number** from the tables above
2. **What actually happened**
3. **Which side** (teacher / student) and **which browser**
4. **Screenshot** if it's visual

Browser console errors help a lot: **F12 → Console**, screenshot anything red.

---

# Not part of this test

These need extra cloud services and are **switched off**:

- **Recording** — needs a storage bucket
- **Live captions / transcript** — needs a speech-to-text key

If a Record or Captions button says "not configured", that is **expected**, not
a bug.

---

# Shutting down (Person A)

```bash
# Ctrl-C in Terminals 2 and 3, then:
cd backend && docker compose down
```

To also delete the test database:

```bash
cd backend && docker compose down -v
```
