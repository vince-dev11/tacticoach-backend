# Hosting cost for 100 active coaches (5 Oct 2026)

## What 100 active coaches need

This is estimated from how TactiCoach works today: one API, MySQL, nginx and uploads on one server.

| Resource | 100 active coaches | Why |
|---|---|---|
| CPU / memory | **2 vCPU, 4 GB RAM** | Node + MySQL + nginx with room for builds. At most a handful of coaches are on at the same moment. Today's 2 GB box is already tight. |
| Disk | **60–80 GB** | Thumbnails (~100 KB each), 720p preview videos (~5 MB each), logos, book images. About 30 MB per coach comes to about 3 GB, plus MySQL (<2 GB), the OS, logs and local backups. Today's disk is only about 8 GB. |
| Traffic out | **30–150 GB a month** (I use 60 GB) | App loads, JSON (now gzipped) and media (now cached by the browser). Video sharing is the variable part. |
| Requests | ~50–100k a month | Tiny for any server. |

So 100 coaches is still a **one-small-server** job. The bill is almost all the fixed price of that server, and only traffic grows with users.

## Monthly cost, same workload everywhere

Figures are USD, before tax, using public prices found on 5 Oct 2026 (sources below). Totals include disk, a public IP and 60 GB of traffic. Indian providers bill in INR; AWS India adds 18% GST, and so do Indian hosts.

| Provider | Plan / region | Server | Disk + IP + 60 GB traffic | **≈ Total/month** | Notes |
|---|---|---|---|---|---|
| **AWS EC2 (today's setup, bigger)** | t3.medium, London | $34.5 | ~$11 (80 GB gp3 ~$7.4, IPv4 $3.6, traffic free under 100 GB) | **~$45** | Pay-per-part. Traffic over 100 GB costs $0.09/GB. |
| AWS EC2 (ARM) | t4g.medium, London | $27.4 | ~$11 | **~$38** | Needs an ARM build (Node is fine). |
| AWS EC2 (India) | t4g.medium, Mumbai | $16.4 | ~$11 | **~$27** | Cheap, but far from UK coaches (see the latency section below). |
| **AWS Lightsail** | 4 GB, London (or Mumbai) | $24 | included (80 GB disk, IPv4, 4 TB traffic) | **~$24** | Same AWS account. The easiest move. |
| Google Cloud | e2-medium, London | $31.5 | ~$19 (disk ~$9, IP ~$3, traffic $0.12/GB ≈ $7) | **~$50** | The most expensive here; every GB of traffic is paid. |
| Microsoft Azure | B2s, UK South | $34.5 | ~$9 (disk ~$5, IP ~$3.6; first 100 GB traffic free) | **~$43** | A similar range to EC2. |
| **Akamai (Linode)** | Shared 4 GB, London or Mumbai | $24 | included (80 GB, 4 TB traffic; overage $0.005/GB) | **~$24** | Simple and predictable. |
| DigitalOcean | 2 vCPU / 4 GB, London or Bangalore | $24 | included (80 GB, 4 TB; overage $0.01/GB) | **~$24** | Simple, with London and India regions. |
| **Hetzner** | CX33: 4 vCPU / **8 GB**, Germany/Finland | ~€8.49 (~$10) | included (80 GB, 20 TB) | **~$10–12** | The cheapest, with twice the memory. EU only (no UK or India). Backups +20%. |
| **Utho (India)** | 2 vCPU / 4 GB, 80 GB NVMe | ₹1,299 (~$15) | included (4 TB) | **~₹1,300–1,500** | Indian billing and GST invoice. Hosted in India. |
| E2E Networks (India) | 2 vCPU / 8 GB | about ₹1,182 (reported) | disk/IP extra | **~₹1,500–2,500** | Prices changed 1 July 2026; check the current price list before choosing. |

**Optional media storage:** Cloudflare R2 for videos and images. The first 10 GB is free, then $0.015/GB, with **no traffic fees**. At 100 coaches that's about $0–1 a month.

## The deciding factor: where are the coaches?

TactiCoach is **UK-first**, with growth across Europe and the USA. A page in the editor makes many API calls:

- A server in **London or the EU** answers UK coaches in about 10–30 ms per call.
- A server in **India** adds about 120–150 ms per call for UK coaches. The editor and library feel slower, even though the bill is lower.

Host near the users, not near the company. An India server only makes sense if most coaches are in India.

## Recommendation for 100 coaches

1. **Best value: Hetzner CX33 (Germany/Finland), ~$10–12 a month,** plus Cloudflare (free) in front and R2 for media.
   - Double the memory of the others for half the price, and close to the UK.
2. **Best balance of price and ease, with London: AWS Lightsail 4 GB London (~$24), or Akamai or DigitalOcean London (~$24).**
   - Lightsail is the smallest change from today: same AWS account, same tools, fixed price, traffic included.
3. **Avoid for this size: Google Cloud, Azure and plain EC2 (~$38–50).** They're built for large, pay-per-part setups; at our size you pay more for the same server.
4. **India hosts (Utho, E2E, Mumbai regions):** only if the main market becomes India.

**Cost per coach:**

| Option | Monthly | Per active coach |
|---|---|---|
| Hetzner | ~$12 | **~$0.12** |
| Lightsail | ~$24 | **~$0.24** |
| EC2 London | ~$45 | **~$0.45** |

Any of these is tiny next to one coach's subscription.

**Whichever you choose:**

- keep the nightly database backup going **off** the server;
- give the disk room to grow;
- move videos to R2 before they fill the server's disk.

## Sources

- [Google Cloud e2-medium prices and egress (DevZero)](https://www.devzero.io/blog/google-cloud-server-cost)
- [Azure B2s prices (CloudPrice)](https://cloudprice.net/vm/Standard_B2s)
- [Akamai Linode 4 GB plan (Better Stack)](https://betterstack.com/community/guides/web-servers/linode-akamai-review/)
- [AWS EC2 t4g/t3 prices (Vantage)](https://instances.vantage.sh/aws/ec2/t4g.medium)
- [AWS data transfer out (egresscost.com)](https://egresscost.com/aws/data-transfer-pricing/)
- [Amazon Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
- [DigitalOcean droplet pricing 2026 (Fluence)](https://fluence.ai/blog/digitalocean-droplets-vs-fluence/)
- [Hetzner price adjustment, June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Utho pricing (getinfra.cloud)](https://getinfra.cloud/providers/utho)
- [E2E Networks pricing note](https://gbnodes.host/blogs/e2e-networks-price-increase-2026-explained/)
- [Cloudflare R2 pricing (egresscost.com)](https://egresscost.com/cloudflare/)

Your own September AWS bill (checked in your console) was the baseline: a t3.small at $14.87, an IPv4 at $3.44, 8 GB of disk at $0.64, a $4.74 free-tier credit and $2.56 tax, **$16.77 in total**.
