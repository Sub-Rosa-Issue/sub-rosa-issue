import { motion, useReducedMotion } from "framer-motion";
import { DEMO_TRACE } from "../demo/trace";
import { USE_CASES, type UseCaseId } from "../config/useCases";
import { LOGO_SRC } from "../lib/chain";
import { shortAddr } from "../lib/format";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

const staggerParent = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.12,
    },
  },
};

export function LandingPage({
  onDemo,
  onCase,
}: {
  onDemo: () => void;
  onCase: (useCase: UseCaseId) => void;
}) {
  const reduce = useReducedMotion();

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <main className="landing-page">
      <motion.nav
        className="landing-nav"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <button type="button" className="brand-link" onClick={onDemo}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="landing-nav-actions">
          <span className="landing-status-pill winner">Hack Privacy #1</span>
          <span className="landing-status-pill">testnet · live</span>
          <a href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="#/dashboard" className="secondary-action compact">
            Dashboard
          </a>
          <button type="button" className="primary-action compact" onClick={onDemo}>
            Open demo
          </button>
        </div>
      </motion.nav>

      <motion.section
        className="landing-hero"
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        <motion.div className="hero-copy" variants={fadeUp} transition={transition}>
          <span className="hero-eyebrow">
            <span>SR</span>
            Verifiable allocation on Stellar
          </span>
          <motion.h1 variants={fadeUp} transition={transition}>
            Verifiable allocation. <em>Sealed by design.</em>
          </motion.h1>
          <motion.p className="lede" variants={fadeUp} transition={transition}>
            Infrastructure for Stellar grants, bounties, hackathons, sealed auctions, and RFP
            scoring.
          </motion.p>
          <motion.p className="hero-infra-line" variants={fadeUp} transition={transition}>
            Scores, bids, and allocation inputs stay unreadable until Drand R, then reveal and
            settle publicly on Soroban.
          </motion.p>

          <motion.div className="hero-actions" variants={fadeUp} transition={transition}>
            <button type="button" className="primary-action large" onClick={onDemo}>
              Open sealed grant scoring demo
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <a className="secondary-action" href="#/architecture">
              Read the architecture
            </a>
          </motion.div>

          <motion.div
            className="hero-metrics"
            aria-label="Proof points"
            variants={fadeUp}
            transition={transition}
          >
            <div>
              <span>Drand gate</span>
              <strong>R {DEMO_TRACE.meta.revealRound.toLocaleString()}</strong>
            </div>
            <div>
              <span>Settlement</span>
              <strong>{DEMO_TRACE.keeper.contractBalanceFinal} USDC final</strong>
            </div>
            <div>
              <span>First pilot</span>
              <strong>OverBlock</strong>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          className="hero-console"
          variants={fadeUp}
          transition={{ ...transition, delay: 0.18 }}
          aria-hidden="true"
        >
          <div className="console-status-row">
            <div>
              <span>allocation round</span>
              <strong>Scores sealed</strong>
            </div>
            <span className="status-tag">commit live</span>
          </div>

          <div className="seal-stage">
            <span className="seal-pulse" />
            <span className="seal-pulse" />
            <span className="seal-pulse" />
            <div className="seal-orb">
              <img src={LOGO_SRC} alt="" />
            </div>
            <span className="seal-chip commit">
              <i />
              commit · H
            </span>
            <span className="seal-chip cipher">
              <i />
              ciphertext
            </span>
            <span className="seal-chip drand">
              <i />
              Drand R
            </span>
          </div>

          <div className="console-events">
            <p>
              <strong>1</strong>
              <span>Judges submit sealed scores</span>
              <em>private</em>
            </p>
            <p>
              <strong>2</strong>
              <span>Drand R opens the scoring set</span>
              <em>public</em>
            </p>
            <p>
              <strong>3</strong>
              <span>Soroban settles the result</span>
              <em>verifiable</em>
            </p>
          </div>

          <div className="proof-strip">
            <span>{shortAddr(DEMO_TRACE.meta.contractId, 6)}</span>
            <span>sealed scoring</span>
            <span>round #{DEMO_TRACE.meta.roundId}</span>
          </div>
        </motion.div>
      </motion.section>

      <motion.section
        className="pilot-banner"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={transition}
      >
        <div>
          <span>First internal pilot</span>
          <h2>OverBlock</h2>
        </div>
        <p>
          OverBlock will be Sub Rosa&apos;s first internal pilot environment for sealed judging,
          bounty allocation, and grant-style scoring workflows.
        </p>
        <p>
          We are also preparing small external pilot conversations with Stellar ecosystem teams,
          hackathon organizers, DAOs, and grant/RFP programs.
        </p>
      </motion.section>

      <section className="landing-cases-section">
        <motion.div
          className="landing-cases-head"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={transition}
        >
          <h2>Run a verifiable allocation workflow.</h2>
          <p>
            Each case uses the same sealed-round primitive: inputs stay hidden until reveal, then
            the result is public and enforceable on Stellar.
          </p>
        </motion.div>

        <motion.div
          className="landing-cases"
          variants={staggerParent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {USE_CASES.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              className="case-card-link"
              onClick={() => onCase(item.id)}
              variants={fadeUp}
              transition={transition}
              whileHover={reduce ? undefined : { y: -3 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
            >
              <span>{item.tagline}</span>
              <strong>{item.oneLine}</strong>
            </motion.button>
          ))}
        </motion.div>
      </section>
    </main>
  );
}
