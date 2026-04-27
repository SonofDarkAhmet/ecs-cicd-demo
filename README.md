# Jokes App — Containerised MERN Stack on AWS ECS

A small MERN application (MongoDB, Express, React, Node) used as an end-to-end demo of **containerisation with Docker**, **deployment to AWS ECS (Fargate) behind an Application Load Balancer**, and a **fully automated CI/CD pipeline with GitHub Actions**.

The app itself is intentionally simple — post a joke, list jokes — so the focus is the platform around it.

---

## Architecture

```
                                    ┌────────────────────────────────┐
                                    │        AWS Application LB      │
                                    │  ECS-LoadBalancer (eu-north-1) │
                                    └──────────────┬─────────────────┘
                                                   │  :80
                                                   ▼
                ┌────────────────────────────────────────────────────────┐
                │                ECS Cluster — ECSdemocluster            │
                │                                                        │
                │   ECS Service (ECSdemoservice)                         │
                │   └── Task (ECSdemotd) — Fargate                       │
                │        ├── Container: react-client (nginx, port 80)    │
                │        └── Container: api-jokes    (node,  port 5000)  │
                └─────────────────────────────┬──────────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────────┐
                                    │   MongoDB Atlas      │
                                    │  (managed, external) │
                                    └──────────────────────┘

   Build & deploy is triggered on push to `main` via GitHub Actions:
   Docker Hub  ←  build/push  ←  GitHub Actions  →  render task def  →  ECS deploy
```

## Tech stack

| Layer        | Tooling                                                              |
|--------------|----------------------------------------------------------------------|
| Frontend     | React 18, Vite, React Router, served by nginx in prod                |
| Backend      | Node.js 20, Express, Mongoose                                        |
| Database     | MongoDB (Atlas in prod, container in dev)                            |
| Containers   | Docker, Docker Compose, multi-stage builds                           |
| Registry     | Docker Hub                                                           |
| Cloud        | AWS ECS (Fargate), Application Load Balancer, eu-north-1             |
| CI/CD        | GitHub Actions (`docker/*`, `aws-actions/*`)                         |

---

## Repository layout

```
jokes-app-mern/
├── API-jokes/                  Node/Express API
│   ├── Dockerfile              dev image (npm run dev, --watch)
│   └── Dockerfile.prod         prod image (npm start)
├── react-client/               React + Vite SPA
│   ├── Dockerfile              dev image
│   ├── Dockerfile.prod         multi-stage: vite build → nginx:stable-alpine
│   └── nginx.conf              SPA fallback to /index.html
├── env/                        local-only env files (gitignored)
├── docker-compose.yaml         dev: api + client + mongo on user-defined networks
├── docker-compose.prod.yaml    prod-shape compose (Atlas + nginx)
└── .github/workflows/
    └── ecs-deployment.yaml     build → push → render task def → ECS deploy
```

---

## Docker — what's worth pointing at

**Multi-stage build for the React client** ([react-client/Dockerfile.prod](react-client/Dockerfile.prod))
A `node:20-alpine` builder runs `vite build`, then the static `dist/` is copied into a fresh `nginx:stable-alpine` image. The runtime image ships zero Node tooling — only nginx and the compiled assets.

**Build-time API URL injection** — `VITE_API_BASE_URL` is wired through `ARG` → `ENV` so the SPA is built against the correct backend (localhost in dev, the ALB DNS name in prod).

**SPA-aware nginx** ([react-client/nginx.conf](react-client/nginx.conf)) — `try_files $uri $uri/ /index.html;` so client-side routes don't 404 on refresh.

**Network segmentation in dev** ([docker-compose.yaml](docker-compose.yaml))
- `db-net` — connects only the API and Mongo
- `server-net` — connects the API and the React client
The Mongo container is unreachable from the frontend network. Only the API straddles both.

**Hot reload via Compose `develop.watch`** — changes under `./API-jokes` and `./react-client` sync into the running containers without a rebuild.

---

## AWS — what's deployed

- **ECS Cluster:** `ECSdemocluster`
- **Service:** `ECSdemoservice` (Fargate)
- **Task definition family:** `ECSdemotd` — one task running both containers
- **Region:** `eu-north-1`
- **Load balancer:** `ECS-LoadBalancer-232098305.eu-north-1.elb.amazonaws.com` — fronts the React container on :80; the React app calls the API on :5000 via the ALB DNS.
- **Database:** MongoDB Atlas (connection string injected via task definition env).

The two containers live in the **same task** so they share a network namespace — the SPA's API base URL points at the ALB, which routes to the API container.

---

## CI/CD — GitHub Actions pipeline

[.github/workflows/ecs-deployment.yaml](.github/workflows/ecs-deployment.yaml) runs on every push to `main` (and on `workflow_dispatch`). Three jobs:

1. **`build-image-node`** — builds and pushes `…/ecs-aws-demo` to Docker Hub. Tags via [`docker/metadata-action`](https://github.com/docker/metadata-action) (`latest` + `v1.0.<run_number>`), build via [`docker/build-push-action`](https://github.com/docker/build-push-action) using `Dockerfile.prod`.
2. **`build-image-react`** — same pattern for `…/ecs-aws-react-demo`. Passes `VITE_API_BASE_URL` as a `build-args` so the SPA bundle is baked with the correct API URL.
3. **`deploy-to-ecs`** — depends on both builds. Uses [`aws-actions/amazon-ecs-render-task-definition`](https://github.com/aws-actions/amazon-ecs-render-task-definition) **chained twice** — once per container — to produce a new task definition revision pointing at the freshly pushed image tags, then [`aws-actions/amazon-ecs-deploy-task-definition`](https://github.com/aws-actions/amazon-ecs-deploy-task-definition) registers it and updates the service.

Why chain `render-task-definition` twice: the action only patches one container per call, so the output of the first invocation is fed in as `task-definition:` to the second.

### Required GitHub configuration

| Kind     | Name                    | Purpose                                  |
|----------|-------------------------|------------------------------------------|
| Secret   | `DOCKER_PASSWORD`       | Docker Hub access token                  |
| Secret   | `AWS_ACCESS_KEY_ID`     | Deployer IAM user                        |
| Secret   | `AWS_SECRET_ACCESS_KEY` | Deployer IAM user                        |
| Variable | `DOCKER_USERNAME`       | Docker Hub namespace                     |

The deployer IAM user needs `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`, and `iam:PassRole` on the task execution role.

---

## Running locally

Prereqs: Docker Desktop, plus env files in `env/` (see below).

```bash
# dev — hot reload, Mongo in a container
docker compose up --build

# prod-shape — Atlas backend, nginx-served SPA
docker compose -f docker-compose.prod.yaml up --build
```

- API:    http://localhost:5000
- Client: http://localhost:3000 (dev) or http://localhost (prod compose)

### Env files

```
env/mongo.env          MONGO_INITDB_ROOT_USERNAME / _PASSWORD
env/server.env         MONGODB_URI for the local Mongo container
env/server.prod.env    MONGODB_URI for Atlas
```

`env/` is gitignored — the values are not in the repo.

---

## API surface

| Method | Path         | Description                          |
|--------|--------------|--------------------------------------|
| GET    | `/`          | Health/info banner                   |
| GET    | `/getJokes`  | List all jokes                       |
| POST   | `/post-joke` | Create a joke (`{ "joke": "..." }`)  |
| GET    | `/crash`     | Intentionally exits — used to verify ECS task restart behaviour |

---

## Skills demonstrated

- **Docker:** multi-stage builds, dev vs. prod image variants, build-arg/env wiring, user-defined networks for isolation, Compose `develop.watch` for live sync, nginx-served SPA with client-route fallback.
- **AWS:** ECS Fargate cluster + service + task definition with two containers in one task, ALB fronting the stack, region-specific deploy, Atlas as managed data tier, least-privilege IAM for the deployer.
- **GitHub Actions:** matrixed image build/push to Docker Hub with semantic + run-numbered tags, chained task-definition rendering for multi-container tasks, `needs:` dependency between build and deploy jobs, secrets/vars hygiene.
