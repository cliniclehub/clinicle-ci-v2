Using small baseline sizes in Huawei Cloud’s **ME‑Riyadh** region, I would budget approximately **$220–$250/month (SAR 825–938)** for the CCI design before VAT and meaningful outbound traffic.

### Estimated CCI configuration

Assumptions:

- 730 running hours per month
- Frontend: `0.25 vCPU / 0.5 GiB`
- Backend: `0.5 vCPU / 1 GiB`
- Cron: `0.25 vCPU / 0.5 GiB`, running 10 minutes each hour
- PostgreSQL: `2 vCPU / 4 GiB / 40 GB SSD`
- One public shared load balancer
- Low traffic and modest logs

| Resource | Estimated USD/month | Estimated SAR/month |
|---|---:|---:|
| Frontend CCI pod | $36 | SAR 136 |
| Backend CCI pod | $72 | SAR 272 |
| CronJob executions | $6 | SAR 23 |
| RDS PostgreSQL, pay-per-use | $72 | SAR 271 |
| Shared ELB | ~$37 | ~SAR 137 |
| EIP traffic, logs and DNS | ~$5–$20 | ~SAR 19–75 |
| SWR image repository | Usually $0 | Usually SAR 0 |
| **Estimated total** | **$228–$243** | **SAR 855–911** |

The CCI figures use Huawei’s published general-compute package rates—approximately `$0.15876/vCPU-hour` and `$0.01986/GiB-hour`—as the estimation basis. CCI charges are calculated from provisioned CPU, memory and running time. Actual ME‑Riyadh pay-per-use prices shown during pod creation may differ. ([CCI billing](https://support.huaweicloud.com/intl/en-us/price-cci2/Cloud%20Container%20Instance%20Billing%20%28CCI%202.0%29-pdf.pdf))

Huawei publishes a current Riyadh example of **$72.29/month pay-per-use** or **$58.30/month with a monthly commitment** for PostgreSQL with 2 vCPU, 4 GB RAM and 40 GB SSD. ([Riyadh cost example](https://support.huaweicloud.com/intl/en-us/berpbo-ctf/berpbo_02.html))

These estimates are for one replica of each application. Two replicas of both frontend and backend would add about **$109/month**, bringing the total close to **$340/month**.

### The cron job does not need an always-running instance

Use a CCI/Kubernetes **CronJob** based on your backend image. CCI is billed by the second from pod creation until deletion, so the cron container costs money only while it runs. ([CCI pay-per-use rules](https://support.huaweicloud.com/intl/en-us/price-cci2/cci_06_1004.html))

For example, a `0.25 vCPU / 0.5 GiB` job running:

- 10 minutes every hour: approximately **$6/month**
- 10 minutes daily: approximately **$0.25/month**
- One hour daily: approximately **$3/month**

You do not need a fourth permanent server unless your scheduler is an application-specific worker that must remain running continuously.

### Wildcard SSL is not included with CCI

CCI does **not** automatically issue or manage a wildcard certificate. CCI runs the containers; HTTPS is normally terminated by the public load balancer or ingress.

You have two practical options:

1. **Free automated certificate**

   Run an ACME-compatible certificate manager and obtain a Let’s Encrypt wildcard certificate using DNS-01 validation. This can be free, but you must configure and monitor the automation yourself.

2. **Huawei-managed wildcard certificate**

   Purchase a wildcard certificate through Huawei Cloud Certificate Manager and attach it to the HTTPS listener. Huawei currently advertises certificates starting around:

   - GeoTrust DV: **$159/year and up**
   - GeoTrust OV: **$309/year and up**

   That is approximately **$13.25–$25.75/month when annualized**, although it is charged as a certificate purchase rather than a normal monthly resource. ([Huawei SCM pricing](https://www.huaweicloud.com/intl/en-us/product/scm.html))

A certificate for `*.example.com` covers names such as `api.example.com` and `app.example.com`, but not `something.api.example.com`. ([Wildcard rules](https://support.huaweicloud.com/intl/en-us/ccm_faq/ccm_01_0265.html))

### More economical baseline

For this workload, CCI is convenient but relatively expensive when two pods run continuously. A cheaper arrangement is:

- One **Flexus X ECS**, `2 vCPU / 4 GB`, running Docker Compose
  - frontend
  - backend
  - cron using the host scheduler or a scheduled container
- Separate RDS PostgreSQL
- Caddy or Traefik on the ECS for automatic free SSL

Huawei’s Riyadh pricing example lists that ECS at **$43.83/month committed**, with RDS at **$58.30/month committed**. The resulting baseline would be approximately:

| Resource | USD/month |
|---|---:|
| Flexus X ECS | $43.83 |
| RDS PostgreSQL | $58.30 |
| Public traffic and EIP | $5–$20 |
| SSL through Caddy/Let’s Encrypt | $0 |
| **Estimated total** | **$107–$122** |
| **Estimated SAR** | **SAR 401–458** |

For a small application migrating from Render, I would start with **ECS + Docker Compose + RDS**, unless automatic pod scaling or serverless execution is important. It should cost roughly half as much as keeping two small CCI pods online continuously.