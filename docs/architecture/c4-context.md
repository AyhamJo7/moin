# C4 — system context and containers

Two levels. Component diagrams are deliberately absent: at this size they would restate the module
list in `domain-model.md` and then rot, because nothing regenerates them.

## Level 1 — system context

Who and what the system talks to, and why.

```mermaid
graph TB
    caller["Anrufer<br/><i>a customer of the business</i>"]
    owner["Betriebsinhaber / Mitarbeiter<br/><i>the paying customer</i>"]
    operator["iQuantum operator<br/><i>support, time-boxed access</i>"]

    moin["<b>moin</b><br/>Digitales Front Office<br/><i>answers the phone, turns calls into work</i>"]

    twilio["Twilio<br/><i>telephone network, ConversationRelay</i>"]
    openai["OpenAI (EU)<br/><i>understanding speech, no training</i>"]
    cognito["AWS Cognito<br/><i>who is signing in</i>"]
    stripe["Stripe<br/><i>subscriptions</i>"]
    calendar["Google / Microsoft<br/><i>calendar and mailbox, per tenant</i>"]
    ses["AWS SES<br/><i>email to the owner</i>"]

    caller -->|"calls, speaks German"| twilio
    twilio <-->|"webhook + audio stream"| moin
    moin -->|"utterance text, transiently"| openai
    owner -->|"reads Today, acts on tasks"| moin
    operator -.->|"only with a granted,<br/>time-boxed support grant"| moin
    moin -->|"authentication"| cognito
    moin -->|"metering and subscriptions"| stripe
    moin <-->|"availability, booking"| calendar
    moin -->|"notifications"| ses

    classDef human fill:#e8f0fe,stroke:#4285f4
    classDef system fill:#fff,stroke:#333,stroke-width:2px
    classDef ext fill:#f5f5f5,stroke:#999
    class caller,owner,operator human
    class moin system
    class twilio,openai,cognito,stripe,calendar,ses ext
```

**The caller never touches the product directly.** They ring a telephone number. That is the whole
proposition: the customer's customer does not have to learn anything, install anything or consent
to anything beyond the disclosure they hear (INV-03).

**The operator arrow is dotted** because it does not exist by default. An operator sees tenant data
only through a grant the customer gives, which is time-boxed and audited (ADR-0037).

## Level 2 — containers

```mermaid
graph TB
    subgraph aws["AWS eu-central-1"]
        subgraph public["public subnet"]
            alb["Application Load Balancer"]
        end

        subgraph private["private subnets"]
            web["<b>web</b><br/>Next.js<br/><i>owner app + ops routes</i>"]
            api["<b>api</b><br/>NestJS/Fastify<br/><i>owner-facing HTTP</i>"]
            voice["<b>voice</b><br/>NestJS/Fastify<br/><i>webhooks + ConversationRelay WS</i>"]
            worker["<b>worker</b><br/><i>queues, timers, outbox</i>"]
            migrate["<b>migrate</b><br/><i>one-shot, then exits</i>"]
        end

        subgraph data["data"]
            pg[("PostgreSQL 17 + pgvector<br/><i>FORCE RLS on every tenant row</i>")]
            valkey[("Valkey<br/><i>cache, pub/sub, rate limits</i>")]
            sqs["SQS + DLQ"]
            s3[("S3<br/><i>exports, attachments</i>")]
            secrets["Secrets Manager<br/><i>credentials by ARN</i>"]
        end
    end

    browser["Browser"] --> alb
    telephony["Twilio"] --> alb
    alb --> web
    alb --> api
    alb --> voice

    web --> api
    api --> pg
    api --> valkey
    api --> sqs
    voice --> pg
    voice --> sqs
    worker --> pg
    worker --> sqs
    worker --> s3
    migrate --> pg
    api --> secrets
    voice --> secrets
    worker --> secrets

    classDef svc fill:#e8f0fe,stroke:#4285f4
    classDef store fill:#fff3e0,stroke:#f9a825
    class web,api,voice,worker,migrate svc
    class pg,valkey,sqs,s3,secrets store
```

**All five containers are the same image**, started with a different command (INV-17). The boxes
differ by module graph and by scaling policy, not by artefact.

**`voice` is separated from `api` for failure reasons, not scale.** A voice session is a long-lived
WebSocket with hard deadlines; a deploy that interrupts one drops a call a human is on (INV-19).
Separating them lets voice drain on its own schedule.

**`migrate` runs to completion and exits.** It is the only role permitted to run DDL, so an
application-level SQL injection cannot alter the schema (ADR-0003).

**Nothing in the data row is reachable from the internet.** The load balancer terminates in the
public subnet; everything else is private.
