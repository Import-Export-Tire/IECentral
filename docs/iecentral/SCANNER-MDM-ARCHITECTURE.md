# Scanner MDM — What Runs Where

Four moving parts: the scanners, the app you click, the code on the device, and AWS in the
middle. This is what each is responsible for, and why AWS is involved at all.

**Fleet:** Zebra TC51 · Android 8.1 (API 27) · Latrobe (W08), Everson (R10), Chestnut Ridge (W09)
**Cloud:** AWS IoT Core, us-east-1, account 381491950294

---

## Why there's a cloud service at all

A scanner sits on store Wi-Fi behind a router. There is no address you can dial to reach it —
from the outside it isn't visible. So the relationship has to be inverted: **the scanner calls
out and holds the line open.**

That's the one job AWS does. Each scanner keeps a permanent outbound connection to AWS IoT Core.
When you press a button in IE Central you aren't reaching the scanner — you hand the instruction
to AWS, and AWS pushes it down the line the scanner already opened. Every other piece of AWS
here exists to support that one fact.

---

## The whole picture

```
        YOU  ┌────────────────────┐
             │ IE Central         │
             │ Next.js + Convex   │
             └────────────────────┘
                      │  ▲
      press a button  │  │  status comes back
                      ▼  │
        AWS  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐
             │ Lambda   │ │ IoT Jobs  │ │ IoT Core │ │ S3       │
             │ 6 fns    │ │ durable   │ │ MQTT     │ │ app      │
             │          │ │ queue     │ │ broker   │ │ files    │
             └──────────┘ └───────────┘ └──────────┘ └──────────┘
                                             │  ▲          ▲
   pushed down the open line ────────────────┘  │          │ downloads
                       telemetry & screen text ─┘          │
                                                           │
      FLOOR  ┌────────────────────┐   ┌──────────────┐     │
             │ Scanner Agent      │──▶│ Zebra TC51   │     │
             │ Android app        │   │ Device Owner │     │
             └────────────────────┘────────────────────────┘
```

**Nothing dials in.** Instructions only ever travel down a connection the scanner opened.

---

## What each AWS service is for

| Service | Its job here |
|---|---|
| **IoT Core** | The pipe. Every scanner is a registered "thing" with its own X.509 certificate and a policy saying which topics it may use. Telemetry and acknowledgements go up; commands come down. |
| **IoT Jobs** | **What makes commands trustworthy.** Plain MQTT is fire-and-forget — a message to a switched-off scanner is discarded permanently. Jobs stores the instruction on AWS *indefinitely* and delivers it when the device next appears, and tracks per-device status so "did it land?" has an answer. |
| **Lambda** | Six single-file Python functions. They exist because Convex can't hold AWS credentials and a browser certainly can't. One each to: create a scanner's identity, create a job, hand out an app download link, forward telemetry, forward job status, serve a location's settings. |
| **S3** | `ietires-scanner-assets` — where the app files live. Every agent build is kept; each location's settings pin which one its scanners install. |

---

## Journey one — a scanner is born

The only step that needs a cable, and the reason is Android, not AWS: a few privileges can only
be granted over USB.

```
1. Technician        plug in, press Detect
2. Wizard  → Scanner install the three apps, write the RT config   (over USB)
3. Wizard  → Scanner promote the agent to Device Owner
4. Wizard  → Lambda  create this scanner's identity
5. Lambda  → IoT     register the thing, mint a certificate
6. Lambda  → Wizard  return a 6-digit claim code
7. Technician        type the code into the scanner
8. Scanner → Lambda  trade the code for the certificate + private key
9. Scanner → IoT     connect, and stay connected
                     ── the cable is never needed again ──
```

**Why Chrome only:** the wizard speaks ADB to the device directly over **WebUSB**, which Safari
and Firefox don't implement. It's also why an `adb` server running on the same computer steals
the scanner — two programs can't hold one USB device.

**What only USB can grant** (hence steps 2–3): Device Owner, the accessibility service that
powers screen viewing, the `WRITE_SETTINGS` appop, and the initial certificate.

---

## Journey two — a command travels

The second branch is the important one. Before this existed, a command to a switched-off scanner
was silently thrown away and the screen still said it worked.

```
IF THE SCANNER IS AWAKE
  1. IE Central   →  create job "restart"
  2. IoT Jobs     →  push it down the open connection
  3. Scanner      →  run it, report SUCCEEDED          (~2 seconds)

IF THE SCANNER IS OFF OR OUT OF RANGE
  1. IoT Jobs     →  ** job waits: QUEUED, not lost **  (indefinitely)
  2. Scanner      →  later, on reconnect: "anything for me?"
  3. IoT Jobs     →  hands over everything that was waiting
  4. Scanner      →  run it, report SUCCEEDED
```

Measured on a real scanner: queued **15:46:02**, device powered up **15:46:24**, executed
**400 ms later**.

Status returns by a separate path — AWS emits job-execution events, an IoT rule catches them, a
Lambda forwards them to Convex. So the screen shows what happened, not what was requested.

---

## Journey three — an app updates over the air

Same machinery, with one subtlety that decides whether it works after a long outage.

The instruction does **not** contain a download link. It contains a **placeholder**
(`${aws:iot:s3-presigned-url:...}`), and AWS substitutes a real signed link at the moment the
*device* asks for the instruction.

```
You pick a build
   → job created WITH A PLACEHOLDER
      → …scanner connects (could be minutes, could be a week)…
         → AWS mints a fresh signed link ON COLLECTION
            → scanner downloads from S3
               → verifies the checksum
                  → installs silently (Device Owner)
```

Signed links expire within the hour. If one were generated when you clicked, a scanner that had
been off for a week would wake to a dead link. Because AWS mints it on collection, it's always
fresh — that's what makes "update it whenever it comes back" actually work.

---

## The half that has nothing to do with AWS

Much of what the fleet does is the agent acting locally through Android's **Device Owner**
privilege. AWS only carries the instruction and the report; the authority is on the device.

- **The home screen** — the agent registers itself as the launcher, which is how it shows exactly
  three apps. Android keeps the stock launcher's icon layout in a database only root can touch,
  so becoming the launcher was the only route. It deliberately waits until the scanner is
  provisioned, so a fresh device keeps its normal drawer.
- **The PIN** — the device generates it, applies it via `resetPassword`, refuses guessable ones
  (all-same, or runs counting up or down), and undoes an employee's change in about a second.
  Nobody types a PIN anywhere.
- **Lockdown and restrictions** — disabling the apps a worker doesn't need, and blocking factory
  reset, account changes, safe boot and force-stop.
- **Screen viewing** — an accessibility service reads what's on screen as *text*. Android 8.1
  gives even a Device Owner no screenshot API, so a text mirror is the ceiling — enough to see
  which screen someone is stuck on and what it says.

---

## The rule everything else follows from

**IE Central shows what the scanner reports — never what someone typed.**

That rule was bought the hard way. The wizard used to invent a PIN, display it and save it, while
the scanner quietly generated a different one. The screen said `7275`; the device had `850186`.
The same shape of mistake appeared three more times: a PIN field that only wrote to the database,
a version number typed by hand, and a config value that never reached the device.

So the direction of travel is fixed: **you request → the device decides and reports → IE Central
displays what was reported.** A queued command shows as *waiting*, never as done, because the old
path claimed success even when the message had been discarded.

---

## Where the seams are

```
Scanner ──1──▶ AWS IoT ──2──▶ Lambda ──3──▶ Convex ──4──▶ Your browser
```

- **A new piece of information must be added at every hop.** Three of the four pass fields
  through an explicit allowlist, so missing one makes the data vanish silently while everything
  else keeps working. That is exactly why scanners displayed "vunknown" for months, and it bit
  again on the screen-viewing payload.
- **Nothing can wake a sleeping scanner.** Not AWS, not us. Commands wait in the queue and land
  the moment it's picked up — acceptable, because every one of them matters when someone is
  holding the device.
- **Only birth needs a cable.** Everything after provisioning is remote.

---

## Known gaps

- **Wireless APK install is unproven end to end.** Every mechanism it depends on is proven; an
  actual app install over a job has not yet been observed completing.
- **Infrastructure partly created by hand.** `template.yaml` now describes the Lambdas, IoT rule
  and presign role, but three things can't be expressed there and were done once out-of-band:
  enabling JOB/JOB_EXECUTION events account-wide, the per-location thing groups, and
  `ScannerJobsPolicy` on the Lambda role.
- **The device certificate policy uses broad `*` scoping** rather than per-device least privilege,
  matching the pre-existing pattern.
- **TireTrack and RT Locator carry no version or checksum metadata** in S3, so those two report
  "unverified" rather than being validated.
- **FDE consequence:** a scanner with a lock PIN demands that PIN, typed on the device, after
  every reboot or battery swap before it will finish booting and come online.
