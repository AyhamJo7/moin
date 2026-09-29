# EV-P03-017: C4 context and container diagrams

| Field | Value |
|---|---|
| Evidence ID | EV-P03-017 |
| Item | P03.04.01 |
| Date (UTC) | 2026-09-28 23:16 UTC |
| Commit | `b9f29969dc70690009fb41b4b18b001b64166a1d` |
| Environment | local |
| Command / procedure | docs/architecture/c4-context.md: a system context diagram showing the three human roles, the product and the six external systems, and a container diagram showing the five roles, the load balancer boundary and the five data stores. Component diagrams are deliberately absent — at this size they would restate the module list in domain-model.md and then rot, because nothing regenerates them. |
| Result | PASS. Two things the diagrams make explicit rather than implied: the caller never touches the product — they ring a telephone number, which is the whole proposition, because the customer customer does not have to learn, install or consent to anything beyond the disclosure they hear (INV-03); and the operator arrow is dotted because operator access does not exist by default, only through a customer-granted time-boxed grant. The container diagram states that all five containers are the same image started with a different command (INV-17), and that voice is separated from api for failure reasons rather than scale — a deploy that interrupts a long-lived voice WebSocket drops a call a human is on (INV-19). |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
