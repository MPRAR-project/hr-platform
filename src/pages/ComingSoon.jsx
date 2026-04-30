import React from "react";
import { motion } from "framer-motion";
import { Mail, Rocket, ArrowRight, ShieldCheck, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Site Manager – Coming Soon page (Simple, JavaScript)
 * React (JSX) + Tailwind + Framer Motion + Lucide
 * Theme: Clean white cards, soft purple shadows, Lato typography, rounded-12
 * Primary gradient: #AF54DD → #7617A7
 * No timer, subtle animations only.
 *
 * Setup font in index.html:
 * <link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
 */

function Input(props) {
  return (
    <div className="relative w-full">
      <input
        {...props}
        className={
          "w-full h-12 rounded-xl border border-black/10 pl-11 pr-4 text-[15px] " +
          "placeholder:text-black/50 outline-none focus:ring-4 ring-[#AF54DD]/20 ring-offset-0"
        }
      />
      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-black/50" />
    </div>
  );
}

function GradientButton({ children, className = "", ...rest }) {
  return (
    <button
      {...rest}
      className={
        "group inline-flex items-center justify-center gap-2 h-12 w-full rounded-xl " +
        "bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white text-[16px] " +
        "shadow-[0_10px_30px_rgba(203,48,224,0.22)] hover:shadow-[0_16px_40px_rgba(203,48,224,0.28)] transition-all " +
        "hover:translate-y-[-1px] active:translate-y-0 " +
        className
      }
    >
      {children}
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white">
        <ArrowRight className="h-4 w-4 text-[#CB30E0] transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function FloatingTile({ className = "", delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay }}
      className={"w-[460px] h-[460px] rounded-xl bg-white " + className}
    />
  );
}

export default function ComingSoon() {
  const { switchRole } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="relative min-h-dvh overflow-hidden bg-white font-[Lato]">
      {/* BACKGROUND CLUSTERS (Figma polygons with soft purple shadows) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-420px] -translate-x-1/2 flex gap-8">
          <FloatingTile className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
          <FloatingTile delay={0.05} className="shadow-[0_0_60px_rgba(203,48,224,0.20)]" />
          <FloatingTile delay={0.1} className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
          <FloatingTile delay={0.15} className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
        </div>
        <div className="absolute left-1/2 top-[-120px] -translate-x-1/2 flex gap-8">
          <FloatingTile className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
          <FloatingTile delay={0.05} className="shadow-[0_0_80px_rgba(0,0,0,0.08)]" />
          <FloatingTile delay={0.1} className="shadow-[0_0_60px_rgba(203,48,224,0.20)]" />
        </div>
        <div className="absolute left-1/2 top-[340px] -translate-x-1/2 flex gap-8">
          <FloatingTile className="shadow-[0_0_60px_rgba(203,48,224,0.20)]" />
          <FloatingTile delay={0.05} className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
          <FloatingTile delay={0.1} className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
          <FloatingTile delay={0.15} className="shadow-[0_0_40px_rgba(203,48,224,0.10)]" />
        </div>
      </div>

      {/* HEADER */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="h-9 w-9 rounded-xl bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] grid place-items-center"
          >
            <Rocket className="h-5 w-5 text-white" />
          </motion.div>
          <div className="leading-tight">
            <div className="text-[22px] font-black tracking-tight text-black">MPraR Portal</div>
          </div>
        </div>
        <a href="#notify" className="text-sm font-medium text-black/70 hover:text-black">Notify me</a>
      </header>

      {/* CENTER CARD */}
      <main className="relative z-10 mx-auto grid max-w-[520px] place-items-center px-4 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full rounded-3xl bg-white p-6 shadow-[0_14px_42px_rgba(8,15,52,0.06)]"
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <motion.h1
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-3xl font-black tracking-tight text-black"
            >
              Coming Soon
            </motion.h1>
            <motion.p
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.55, delay: 0.18 }}
              className="text-base text-black/70 max-w-[472px]"
            >
              We’re putting the final touches on <span className="font-semibold text-black">this Website</span> —
              create your company account, add your team, and manage workforce & billing in one place.
            </motion.p>

            <div className="mt-2 h-px w-full bg-black/10" />

            {/* EMAIL CAPTURE */}
            <motion.form
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              id="notify"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const emailEl = form.elements.namedItem("email");
                const email = emailEl && emailEl.value ? emailEl.value.trim() : "";
                if (!email) return;
                alert(`Thanks! We'll notify ${email} when we launch.`);
                form.reset();
              }}
              className="mt-3 w-full space-y-3"
            >
              <div className="flex flex-col gap-3">
                <label htmlFor="email" className="sr-only">Email</label>
                <Input id="email" name="email" type="email" required placeholder="you@company.com" />
                <GradientButton type="submit">Notify me at launch</GradientButton>
              </div>
            </motion.form>

            {/* FOOTER NOTES */}
            <div className="mt-4 grid w-full gap-3 text-left text-sm text-black/60">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> We respect your privacy. Unsubscribe anytime.</div>
            </div>


          </div>
          <div className="flex text-text-accent-purple items-center gap-1 font-bold mt-6 justify-center cursor-pointer hover:underline"
            onClick={() => {
              navigate('/')
            }}>
            <ArrowLeft />
            Back to Dashboard
          </div>
        </motion.div>
      </main>

      <div className="h-12" />
    </div>
  );
}
