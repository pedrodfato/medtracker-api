# Visual novo e dashboard de desktop — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Glassmorphism claro com manchas verdes, inputs e botões novos em todo o app, e o desktop (≥1024px) como dashboard com menu lateral.

**Architecture:** Fundação visual primeiro (tokens/utilitários CSS + componentes base: `AppBackground`, `GlassCard`, `Field`, `SegmentedControl`, `buttonClasses`, `inputClasses`). Depois a casca (menu lateral + barra inferior), e por fim cada página usando só esses blocos. Nenhuma mudança de API.

**Tech Stack:** React 19, Vite, Tailwind CSS v4 (`@utility`), lucide-react, swiper. Repositório: `/home/pedro/Documents/medtrackerproject/medtracker` (frontend), branch `main`.

**Spec:** `medtracker-api/docs/superpowers/specs/2026-11-09-visual-redesign-desktop-dashboard-design.md`.

## Global Constraints

- Tema claro apenas. Fontes: `font-heading` (Plus Jakarta Sans) para títulos, Inter (padrão) para texto.
- Verde da marca `#A3D911` (`bg-primary`, `text-primary-foreground` = `#1A1C18`).
- Manchas do fundo: `#A3D911`, `#7FE0B0`, `#2F9E5B`, sobre base `#F3F6EE`.
- Cards: classe `glass` (ou `glass-strong` em diálogos/menus), `rounded-[24px]`.
- Breakpoint de desktop: `lg` (1024px). Celular continua com a barra inferior; desktop usa o menu lateral.
- **Não mudar lógica nem chamadas de API**; só estrutura visual. Manter todos os `placeholder` existentes dos inputs (testes automatizados dependem deles) e os textos de botões existentes ("Salvar Medicamento", "Salvar Alterações", "Confirmar dose", "Entendi", "Editar", "Excluir", etc.).
- Textos de interface em português do Brasil.
- Verificação de cada task: `npm run build` e `npx eslint <arquivos tocados>` (sem erros novos; os 2 erros antigos de `src/pages/dashboard.tsx` — `set-state-in-effect` no `fetchMedications()` do `useEffect` e `purity` no `Date.now` — são conhecidos e podem continuar). **Não subir servidores.**
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Ação | Task |
|---|---|---|
| `src/index.css` | alterar (limpeza do template + `@utility glass`) | 1 |
| `src/components/appBackground.tsx` | criar | 1 |
| `src/components/glassCard.tsx` | criar | 1 |
| `src/components/buttonStyles.ts` | criar | 1 |
| `src/components/button.tsx`, `src/components/LinkButton.tsx` | alterar | 1 |
| `src/components/ui/input.tsx` | alterar (+ export `inputClasses`) | 1 |
| `src/components/field.tsx` | criar | 1 |
| `src/components/segmentedControl.tsx` | criar | 1 |
| `src/App.tsx` | alterar (monta `AppBackground`) | 1 |
| `src/components/sidebar.tsx` | criar | 2 |
| `src/components/bottomMenu.tsx`, `src/layouts/loggedLayout.tsx` | alterar | 2 |
| `src/pages/login.tsx`, `src/pages/register.tsx`, `src/pages/onBoarding.tsx` | alterar | 3 |
| `src/pages/addMedications.tsx` | alterar | 4 |
| `src/hooks/useMedicationHistory.ts`, `src/components/historyCard.tsx`, `src/components/statCard.tsx`, `src/components/todaySchedule.tsx` | criar | 5 |
| `src/components/todayStrip.tsx`, `src/pages/dashboard.tsx` | alterar | 5 |
| `src/pages/medicationList.tsx`, `src/pages/progress.tsx`, `src/pages/profile.tsx`, `src/pages/reminder.tsx`, `src/components/treatmentSummaryDialog.tsx` | alterar | 6 |

---

### Task 1: Fundação visual

**Files:** ver tabela (Task 1).

**Interfaces (Produces):**
- Classes CSS `glass` e `glass-strong`.
- `AppBackground()` — sem props.
- `GlassCard(props: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "aside" })` — aplica `glass rounded-[24px] p-5` + `className` (merge com `cn`).
- `buttonClasses(variant: ButtonVariant, className?: string): string`; `type ButtonVariant = 'primary' | 'secondary' | 'inverted' | 'outline'`.
- `inputClasses: string` exportado de `src/components/ui/input.tsx` (para `<select>`).
- `Field({ label, htmlFor, icon?, hint?, error?, children })`.
- `SegmentedControl<T extends string>({ value, onChange, options: { value: T; label: React.ReactNode }[], ariaLabel })`.

- [ ] **Step 1: Limpar o CSS herdado do template em `src/index.css`**

1. No bloco `:root { ... }` do topo, trocar `color-scheme: light dark;` por `color-scheme: light;`.
2. Apagar o bloco inteiro `@media (prefers-color-scheme: dark) { :root { ... } #social .button-icon { ... } }` (é o que redefine `--text`, `--text-h`, `--bg` etc. para escuro).
3. Dentro de `@layer base`, substituir o bloco `#root { width: 1126px; ... box-sizing: border-box; }` inteiro por:

```css
  #root {
    min-height: 100svh;
  }
```

4. Acrescentar ao **final** do arquivo:

```css
@utility glass {
  background-color: rgb(255 255 255 / 0.55);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgb(255 255 255 / 0.7);
  box-shadow: 0 8px 32px rgb(31 45 20 / 0.08), inset 0 1px 0 rgb(255 255 255 / 0.6);
}

@utility glass-strong {
  background-color: rgb(255 255 255 / 0.78);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid rgb(255 255 255 / 0.85);
  box-shadow: 0 16px 48px rgb(31 45 20 / 0.12), inset 0 1px 0 rgb(255 255 255 / 0.7);
}
```

- [ ] **Step 2: Fundo com manchas — criar `src/components/appBackground.tsx`**

```tsx
export function AppBackground() {
    return (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#F3F6EE]">
            <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-[#A3D911]/45 blur-[120px]" />
            <div className="absolute top-1/3 -right-40 h-[560px] w-[560px] rounded-full bg-[#7FE0B0]/40 blur-[130px]" />
            <div className="absolute -bottom-48 left-1/4 h-[480px] w-[480px] rounded-full bg-[#2F9E5B]/25 blur-[140px]" />
        </div>
    );
}
```

Em `src/App.tsx`, importar `import { AppBackground } from './components/appBackground';` e renderizar `<AppBackground />` como primeiro filho de `<BrowserRouter>` (antes de `<ScrollToTop />`).

- [ ] **Step 3: `src/components/glassCard.tsx`**

```tsx
import { cn } from "@/lib/utils";

type GlassCardProps = React.HTMLAttributes<HTMLElement> & {
    as?: "section" | "div" | "article" | "aside";
};

export function GlassCard({ as: Tag = "section", className, ...rest }: GlassCardProps) {
    return <Tag className={cn("glass rounded-[24px] p-5", className)} {...rest} />;
}
```

- [ ] **Step 4: Botões — criar `src/components/buttonStyles.ts`**

```ts
import { cn } from "@/lib/utils";

export type ButtonVariant = 'primary' | 'secondary' | 'inverted' | 'outline';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(163,217,17,0.35)] hover:brightness-105',
    secondary: 'glass text-gray-800 hover:bg-white/75',
    inverted: 'bg-gray-900 text-white hover:bg-gray-800',
    outline: 'border border-gray-900/15 bg-white/40 text-gray-900 hover:bg-white/70',
};

export function buttonClasses(variant: ButtonVariant, className = ""): string {
    return cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        className,
    );
}
```

Substituir `src/components/button.tsx` por:

```tsx
import React from "react";
import { buttonClasses, type ButtonVariant } from "./buttonStyles";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: React.ReactNode;
    className?: string;
}

export function Button({ type = "button", variant = 'primary', children, className = "", ...rest }: ButtonProps) {
    return (
        <button type={type} className={buttonClasses(variant, className)} {...rest}>{children}</button>
    );
}
```

Substituir `src/components/LinkButton.tsx` por:

```tsx
import { Link } from "react-router-dom";
import React from "react";
import { buttonClasses, type ButtonVariant } from "./buttonStyles";

interface LinkButtonProps {
    to: string;
    variant?: ButtonVariant;
    children: React.ReactNode;
    className?: string;
}

export function LinkButton({ to, variant = 'primary', children, className = "" }: LinkButtonProps) {
    return <Link to={to} className={buttonClasses(variant, className)}>{children}</Link>;
}
```

- [ ] **Step 5: Input — substituir `src/components/ui/input.tsx` por**

```tsx
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Shared with native <select> elements so every field looks the same.
export const inputClasses =
    "h-12 w-full min-w-0 rounded-2xl border border-white/80 bg-white/60 px-4 text-[15px] text-gray-900 shadow-[inset_0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur-md transition outline-none placeholder:text-gray-400 hover:bg-white/75 focus-visible:border-primary focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-400 aria-invalid:ring-4 aria-invalid:ring-red-400/15"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputClasses, className)}
      {...props}
    />
  )
}

export { Input }
```

- [ ] **Step 6: `src/components/field.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";

type FieldProps = {
    label: string;
    htmlFor: string;
    icon?: LucideIcon;
    hint?: string;
    error?: string;
    children: React.ReactNode;
};

// Label above, optional icon inside the control (give the input `pl-11`), hint or error below.
export function Field({ label, htmlFor, icon: Icon, hint, error, children }: FieldProps) {
    return (
        <div className="flex flex-col gap-1.5 text-start">
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-gray-700">{label}</label>
            <div className="relative">
                {Icon && (
                    <Icon aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-gray-400" />
                )}
                {children}
            </div>
            {error ? (
                <p className="text-xs text-red-500">{error}</p>
            ) : hint ? (
                <p className="text-xs text-gray-500">{hint}</p>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 7: `src/components/segmentedControl.tsx`**

```tsx
type Option<T extends string> = { value: T; label: React.ReactNode };

type SegmentedControlProps<T extends string> = {
    value: T;
    onChange: (value: T) => void;
    options: Option<T>[];
    ariaLabel: string;
};

export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel }: SegmentedControlProps<T>) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="grid gap-1 rounded-2xl bg-gray-900/5 p-1"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(option.value)}
                        className={`h-10 rounded-xl px-2 text-[13px] font-medium transition-all ${
                            active
                                ? "bg-white text-gray-900 shadow-[0_2px_8px_rgba(16,24,40,0.08)]"
                                : "text-gray-500 hover:text-gray-800"
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 8: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/App.tsx src/components/appBackground.tsx src/components/glassCard.tsx src/components/buttonStyles.ts src/components/button.tsx src/components/LinkButton.tsx src/components/ui/input.tsx src/components/field.tsx src/components/segmentedControl.tsx`
Expected: build sem erros; eslint sem erros nesses arquivos. (Se o eslint reclamar de `react-refresh/only-export-components` em `input.tsx` por exportar `inputClasses`, mover `inputClasses` para `src/components/ui/inputClasses.ts` e importar de lá em `input.tsx`.)

- [ ] **Step 9: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add -A src/index.css src/App.tsx src/components
git commit -m "feat: fundação visual com vidro, manchas verdes, inputs e botões novos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Casca — menu lateral no desktop e barra inferior de vidro

**Files:** `src/components/sidebar.tsx` (criar), `src/components/bottomMenu.tsx`, `src/layouts/loggedLayout.tsx`.

**Interfaces:** Consumes `buttonClasses` (Task 1). Produces `Sidebar()`.

- [ ] **Step 1: Criar `src/components/sidebar.tsx`**

```tsx
import { Link, NavLink } from "react-router-dom";
import { LayoutDashboard, Pill, Plus, TrendingUp, User } from "lucide-react";
import logo from "../assets/logo.webp";
import { buttonClasses } from "./buttonStyles";

const NAV = [
    { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
    { to: "/list", label: "Remédios", icon: Pill },
    { to: "/progress", label: "Progresso", icon: TrendingUp },
    { to: "/profile", label: "Perfil", icon: User },
];

export function Sidebar() {
    return (
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 p-5 lg:block">
            <div className="glass flex h-full flex-col gap-8 rounded-[28px] p-6">
                <img src={logo} alt="MedTracker" className="h-8 w-auto self-start" />
                <nav className="flex flex-col gap-1" aria-label="Navegação principal">
                    {NAV.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors ${
                                    isActive
                                        ? "bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(163,217,17,0.35)]"
                                        : "text-gray-600 hover:bg-white/60 hover:text-gray-900"
                                }`
                            }
                        >
                            <Icon className="size-[18px]" />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <Link to="/add" className={buttonClasses("inverted", "mt-auto w-full")}>
                    <Plus className="size-[18px]" />
                    Adicionar remédio
                </Link>
            </div>
        </aside>
    );
}
```

- [ ] **Step 2: Barra inferior de vidro**

Em `src/components/bottomMenu.tsx`, trocar a `className` do `<div>` externo (`"fixed bottom-0 w-full bg-white flex justify-around items-center pt-4 pb-6 px-4 rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.06)] z-50"`) por:

```tsx
"glass-strong fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-[28px] px-4 py-3"
```

- [ ] **Step 3: Layout logado — substituir `src/layouts/loggedLayout.tsx` por**

```tsx
import { Outlet } from 'react-router-dom';
import { Menu } from '../components/bottomMenu';
import { Sidebar } from '../components/sidebar';

export function LogadoLayout() {
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar />
      <div className="min-w-0 flex-1 pb-28 lg:pb-8">
        <div className="mx-auto w-full max-w-[1400px] lg:px-6 lg:pt-5">
          <Outlet />
        </div>
      </div>
      <div className="lg:hidden">
        <Menu />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/components/sidebar.tsx src/components/bottomMenu.tsx src/layouts/loggedLayout.tsx`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/components/sidebar.tsx src/components/bottomMenu.tsx src/layouts/loggedLayout.tsx
git commit -m "feat: menu lateral no desktop e barra inferior de vidro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Entrada — onboarding, login e cadastro

**Files:** `src/pages/onBoarding.tsx`, `src/pages/login.tsx`, `src/pages/register.tsx`.

**Interfaces:** Consumes `GlassCard`, `Field`, `Input` novo, `Button`/`LinkButton` (Task 1).

Regras: manter toda a lógica, estados, `id`s, `placeholder`s, textos e links atuais. Só trocar a estrutura visual.

- [ ] **Step 1: Login — substituir o `return (...)` de `Login` por**

```tsx
    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            <aside className="hidden flex-col justify-between p-12 lg:flex">
                <img src={logo2} alt="MedTracker" className="w-40" />
                <div className="flex flex-col gap-6">
                    <img src={pill1} alt="" className="w-40 drop-shadow-[0_30px_40px_rgba(47,158,91,0.35)]" />
                    <h2 className="m-0 max-w-md font-heading text-5xl font-semibold leading-tight tracking-tight text-gray-900">
                        Seu tratamento, no tempo certo.
                    </h2>
                    <p className="max-w-sm text-gray-600">Lembretes, histórico e adesão de cada remédio num só lugar.</p>
                </div>
                <p className="text-sm text-gray-500">MedTracker</p>
            </aside>

            <main className="flex items-center justify-center px-4 py-10">
                <GlassCard className="glass-strong w-full max-w-md p-8">
                    <img src={logo2} alt="MedTracker" className="mx-auto mb-4 w-32 lg:hidden" />
                    <h1 className="m-0 font-heading text-3xl font-semibold tracking-tight text-gray-900">Bem-vindo de volta!</h1>
                    <p className="mt-1 mb-6 text-sm text-gray-500">Entre para ver seus remédios de hoje.</p>

                    <form onSubmit={handleLogin} className="flex w-full flex-col gap-4">
                        <Field label="E-mail" htmlFor="email" icon={Mail}>
                            <Input
                                id="email"
                                type="email"
                                placeholder="Endereço de Email"
                                required
                                className="pl-11"
                                value={email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                            />
                        </Field>
                        <Field label="Senha" htmlFor="password" icon={Lock}>
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                required
                                placeholder="Senha"
                                className="pl-11"
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                            />
                        </Field>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
                                <Checkbox
                                    checked={showPassword}
                                    onCheckedChange={(checked) => setShowPassword(checked === true)}
                                />
                                Mostrar senha
                            </label>
                            <Link to="/esqueci-senha" className="text-sm text-gray-600 underline-offset-4 hover:underline">
                                Esqueceu a senha?
                            </Link>
                        </div>

                        {errorMsg && <p className="text-center text-sm text-red-500">{errorMsg}</p>}
                        <Button type="submit" className="mt-2 w-full">
                            Login
                        </Button>
                        <p className="text-center text-sm text-gray-600">
                            Não tem uma conta? <Link to="/register" className="font-semibold text-[#5c7d00]">Cadastre-se</Link>
                        </p>
                    </form>
                </GlassCard>
            </main>
        </div>
    )
```

E acrescentar aos imports: `import { Lock, Mail } from "lucide-react"`, `import { GlassCard } from "../components/glassCard"`, `import { Field } from "../components/field"`.

- [ ] **Step 2: Cadastro — mesma estrutura em `register.tsx`**

Substituir o `return (...)` de `Register` pela mesma estrutura de duas colunas do Step 1, com estas diferenças:
- Título `h1`: "Crie sua conta"; subtítulo: "Leva menos de um minuto."
- O `<form onSubmit={handleRegister}>` contém, em ordem, quatro `Field`s embrulhando os quatro `Input`s atuais **sem mudar seus props** (só acrescentar `className="pl-11"`):
  - `label="Nome"`, `htmlFor` = `id` do input de nome, `icon={User}`
  - `label="E-mail"`, `icon={Mail}`
  - `label="Senha"`, `icon={Lock}`
  - `label="Confirmar senha"`, `icon={Lock}`
  (Se algum desses `Input` não tiver `id`, acrescentar `id="name"`, `id="email"`, `id="password"`, `id="confirm-password"` e usar no `htmlFor`.)
- Depois dos campos, o mesmo `<label>` de "Mostrar senha" existente, a mensagem de erro existente, o `Button` de envio existente (`className="mt-2 w-full"`) e o parágrafo de link para login existente, com o link na cor `text-[#5c7d00] font-semibold` e o parágrafo `text-center text-sm text-gray-600`.
- Imports: `User, Lock, Mail` de `lucide-react`, `GlassCard`, `Field`.

- [ ] **Step 3: Onboarding — substituir o `return (...)` de `OnBoarding` por**

```tsx
    return (
        <main className="flex min-h-screen items-center justify-center px-6 py-10">
            <GlassCard className="glass-strong flex w-full max-w-md flex-col items-center gap-6 p-8 text-center lg:max-w-lg lg:p-12">
                <img src={logo} width={200} alt="Logo" />
                <img className="w-[140px] drop-shadow-[0_30px_40px_rgba(47,158,91,0.35)] md:w-[180px]" src={pill} alt="Pill" />
                <div className="flex flex-col gap-3">
                    <h1 className="m-0 font-heading text-4xl font-semibold tracking-tight text-gray-900">Nunca esqueça seu remédio de novo</h1>
                    <p className="text-lg text-gray-600">Sua companhia pessoal para gerenciar seus remédios diários, feita para facilitar sua vida.</p>
                </div>
                <div className="flex w-full flex-col gap-3">
                    <LinkButton to="/register" variant="primary" className="w-full">
                        Criar Conta
                    </LinkButton>
                    <LinkButton to="/login" variant="secondary" className="w-full">
                        Eu já tenho uma conta
                    </LinkButton>
                </div>
            </GlassCard>
        </main>
    )
```

e importar `import { GlassCard } from '../components/glassCard'`.

- [ ] **Step 4: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/onBoarding.tsx src/pages/login.tsx src/pages/register.tsx`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/pages/onBoarding.tsx src/pages/login.tsx src/pages/register.tsx
git commit -m "feat: onboarding, login e cadastro com o visual novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Formulário de remédio

**Files:** `src/pages/addMedications.tsx`.

**Interfaces:** Consumes `GlassCard`, `Field`, `SegmentedControl`, `Input`, `Button`.

Regras: manter todos os estados, validações, `handleSubmit`, `placeholder`s ("Ex: Ritalina", "Ex: 10mg", "Ex: 10") e textos de botão. Só a estrutura do `return`.

- [ ] **Step 1: Imports**

Acrescentar: `import { CalendarDays, Clock, FlaskConical, Pill, Repeat } from "lucide-react";`, `import { GlassCard } from "../components/glassCard";`, `import { Field } from "../components/field";`, `import { SegmentedControl } from "../components/segmentedControl";`.

- [ ] **Step 2: Substituir o `return (...)` de `AddMedication` por**

```tsx
    return (
        <main className="flex min-h-screen justify-center p-5 lg:min-h-0 lg:p-0">
            <GlassCard className="w-full max-w-md p-6 lg:max-w-4xl lg:p-8">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="m-0 font-heading text-2xl font-semibold tracking-tight text-gray-900 lg:text-3xl">
                            {isEditMode ? "Editar Medicamento" : "Novo Medicamento"}
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">Preencha conforme a receita.</p>
                    </div>
                    <Link to="/list" className="text-sm font-medium text-gray-500 hover:text-gray-900">Cancelar</Link>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        <div className="flex flex-col gap-5">
                            <Field label="Medicamento" htmlFor="med-name" icon={Pill}>
                                <Input id="med-name" required placeholder="Ex: Ritalina" className="pl-11" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
                            </Field>
                            <Field label="Dosagem" htmlFor="med-dosage" icon={FlaskConical}>
                                <Input id="med-dosage" required placeholder="Ex: 10mg" className="pl-11" value={dosage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDosage(e.target.value)} />
                            </Field>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[13px] font-medium text-gray-700">Categoria</span>
                                <SegmentedControl
                                    ariaLabel="Categoria"
                                    value={category}
                                    onChange={setCategory}
                                    options={[
                                        { value: "pill", label: "💊 Pílula" },
                                        { value: "drop", label: "💧 Gota" },
                                        { value: "vitamin", label: "☀️ Vitamina" },
                                    ]}
                                />
                            </div>
                            <Field label="Por quantos dias?" htmlFor="med-duration" icon={CalendarDays} hint="Conforme a receita. Hoje conta como o dia 1.">
                                <Input
                                    id="med-duration"
                                    required={!isEditMode}
                                    type="number"
                                    min={1}
                                    max={365}
                                    placeholder="Ex: 10"
                                    className="pl-11"
                                    value={durationDays}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDurationDays(e.target.value)}
                                />
                            </Field>
                        </div>

                        <div className="flex flex-col gap-5 rounded-[20px] bg-white/40 p-5">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[13px] font-medium text-gray-700">Frequência e horário</span>
                                <SegmentedControl
                                    ariaLabel="Frequência"
                                    value={scheduleType}
                                    onChange={setScheduleType}
                                    options={[
                                        { value: "fixed", label: "Todo dia" },
                                        { value: "weekly", label: "Dias específicos" },
                                        { value: "interval", label: "A cada X horas" },
                                    ]}
                                />
                            </div>

                            {scheduleType === "weekly" && (
                                <div className="flex justify-between gap-1.5">
                                    {WEEKDAYS.map(({ label, value }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => toggleDay(value)}
                                            aria-pressed={daysOfWeek.includes(value)}
                                            className={`h-10 flex-1 rounded-xl text-xs font-semibold transition-all ${
                                                daysOfWeek.includes(value)
                                                    ? "bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(163,217,17,0.35)]"
                                                    : "bg-white/70 text-gray-500 hover:text-gray-800"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {(scheduleType === "fixed" || scheduleType === "weekly") && (
                                <Field label="Horário" htmlFor="med-time" icon={Clock}>
                                    <Input id="med-time" required type="time" className="pl-11" value={fixedTime} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixedTime(e.target.value)} />
                                </Field>
                            )}

                            {scheduleType === "interval" && (
                                <Field label="Repetir a cada quantas horas?" htmlFor="med-interval" icon={Repeat}>
                                    <Input id="med-interval" required type="number" min={1} max={24} className="pl-11" value={intervalHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIntervalHours(e.target.value)} />
                                </Field>
                            )}

                            <div className="mt-auto flex items-center gap-3 rounded-2xl bg-tertiary/70 p-4">
                                <span className="text-2xl" aria-hidden="true">🤖</span>
                                <p className="text-sm text-tertiary-foreground">Precisa de ajuda para configurar sua dosagem? Só perguntar!</p>
                            </div>
                        </div>
                    </div>

                    {errorMsg && <p className="text-center text-sm text-red-500">{errorMsg}</p>}

                    <Button type="submit" disabled={isLoading} className="w-full lg:ml-auto lg:w-64">
                        {isLoading ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Salvar Medicamento"}
                    </Button>
                </form>
            </GlassCard>
        </main>
    );
```

Observação de tipos: `setCategory`/`setScheduleType` são setters de `useState` com os tipos união corretos, então servem diretamente como `onChange` do `SegmentedControl`. Se o TypeScript reclamar, usar `onChange={(v) => setCategory(v)}`.

- [ ] **Step 3: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/addMedications.tsx`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/pages/addMedications.tsx
git commit -m "feat: formulário de remédio com campos e controles novos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard de desktop

**Files:** criar `src/hooks/useMedicationHistory.ts`, `src/components/historyCard.tsx`, `src/components/statCard.tsx`, `src/components/todaySchedule.tsx`; alterar `src/components/todayStrip.tsx`, `src/pages/dashboard.tsx`.

**Interfaces:**
- Consumes: `GlassCard`, `buttonClasses` (Task 1); `TodayStrip`, `AdherenceHeatmap`, `TreatmentSummaryDialog`, tipos `Medication`/`MedicationHistory` (já existem).
- Produces: `useMedicationHistory(selectedId: string | null): { history: MedicationHistory | null; failed: boolean }`; `HistoryCard({ medication, selectedId, className? })`; `StatCard({ icon, label, value, hint?, tone? })`; `TodaySchedule({ medications, className? })`; `TodayStrip` passa a aceitar `className?`.

- [ ] **Step 1: `src/hooks/useMedicationHistory.ts`**

```ts
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import type { MedicationHistory } from "../types/medType";

// Loads the selected medication's history. Results for a previous selection are
// ignored, and a failure only counts for the medication that failed.
export function useMedicationHistory(selectedId: string | null) {
    const [history, setHistory] = useState<MedicationHistory | null>(null);
    const [failedId, setFailedId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(`${API_URL}/medications/${selectedId}/history`, {
                    method: 'GET',
                    credentials: 'include',
                });
                if (!response.ok) throw new Error('Failed to fetch history');
                const responseData = await response.json();
                if (!cancelled) setHistory(responseData.data);
            } catch (error) {
                console.error('Error fetching medication history:', error);
                if (!cancelled) setFailedId(String(selectedId));
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    const isCurrent = history !== null && String(history.medicationId) === String(selectedId);
    return {
        history: isCurrent ? history : null,
        failed: !isCurrent && failedId !== null && failedId === String(selectedId),
    };
}
```

- [ ] **Step 2: `src/components/historyCard.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { Medication } from "../types/medType";
import { useMedicationHistory } from "../hooks/useMedicationHistory";
import { AdherenceHeatmap } from "./adherenceHeatmap";
import { GlassCard } from "./glassCard";

type Props = { medication: Medication | null; selectedId: string | null; className?: string };

export function HistoryCard({ medication, selectedId, className }: Props) {
    const { history, failed } = useMedicationHistory(selectedId);
    return (
        <GlassCard className={cn("flex flex-col gap-3 text-start", className)}>
            <h2 className="m-0 text-lg font-semibold text-gray-900">
                Histórico{medication ? ` · ${medication.name}` : ""}
            </h2>
            {failed ? (
                <p className="text-sm text-gray-500">Não foi possível carregar o histórico.</p>
            ) : history ? (
                <AdherenceHeatmap key={history.medicationId} days={history.days} expected={history.expected} taken={history.taken} />
            ) : (
                <p className="text-sm text-gray-500">Carregando...</p>
            )}
        </GlassCard>
    );
}
```

- [ ] **Step 3: `src/components/statCard.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";
import { GlassCard } from "./glassCard";

const TONES = {
    lime: "bg-primary/25 text-[#4d6b00]",
    mint: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-600",
};

type StatCardProps = {
    icon: LucideIcon;
    label: string;
    value: string;
    hint?: string;
    tone?: keyof typeof TONES;
};

export function StatCard({ icon: Icon, label, value, hint, tone = "lime" }: StatCardProps) {
    return (
        <GlassCard className="flex flex-col gap-3 p-4 text-start">
            <div className="flex items-center gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
                    <Icon className="size-5" />
                </span>
                <p className="text-sm text-gray-600">{label}</p>
            </div>
            <p className="font-heading text-2xl font-semibold tracking-tight text-gray-900">{value}</p>
            {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </GlassCard>
    );
}
```

- [ ] **Step 4: `src/components/todaySchedule.tsx`**

```tsx
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Medication } from "../types/medType";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import { GlassCard } from "./glassCard";

function timeOf(med: Medication): string {
    if (med.scheduleType !== "interval" && med.fixedTime) return med.fixedTime;
    if (med.nextDoseAt) {
        return new Date(med.nextDoseAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return "—";
}

function statusOf(med: Medication): { label: string; className: string } {
    const expected = med.today?.expected ?? 0;
    const taken = med.today?.taken ?? 0;
    if (taken >= expected) return { label: "Tomado", className: "bg-emerald-100 text-emerald-700" };
    if (taken > 0) return { label: `${taken}/${expected}`, className: "bg-primary/25 text-[#4d6b00]" };
    return { label: "Pendente", className: "bg-gray-900/5 text-gray-600" };
}

type Props = { medications: Medication[]; className?: string };

export function TodaySchedule({ medications, className }: Props) {
    const items = medications
        .filter((m) => !m.completed && (m.today?.expected ?? 0) > 0)
        .map((m) => ({ med: m, time: timeOf(m) }))
        .sort((a, b) => a.time.localeCompare(b.time));

    return (
        <GlassCard className={cn("flex flex-col gap-3 text-start", className)}>
            <div className="flex items-center justify-between">
                <h2 className="m-0 text-lg font-semibold text-gray-900">Agenda de hoje</h2>
                <Link to="/list" className="text-sm font-medium text-gray-500 hover:text-gray-900">Ver todos</Link>
            </div>
            {items.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma dose prevista para hoje.</p>
            ) : (
                <ul className="flex flex-col divide-y divide-gray-900/5">
                    {items.map(({ med, time }) => {
                        const visual = getMedicationVisual(med.category as MedicationCategory);
                        const status = statusOf(med);
                        return (
                            <li key={med.id} className="flex items-center gap-3 py-3">
                                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-xl ${visual.bgClass}`}>
                                    {visual.emoji}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-gray-900">{med.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {med.dosage}
                                        {med.scheduleType === "interval" && med.intervalHours ? ` · a cada ${med.intervalHours}h` : ""}
                                    </p>
                                </div>
                                <span className="text-sm font-medium tabular-nums text-gray-700">{time}</span>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </GlassCard>
    );
}
```

- [ ] **Step 5: `TodayStrip` aceita `className` e usa vidro**

Em `src/components/todayStrip.tsx`:
1. Acrescentar `import { cn } from "@/lib/utils";`.
2. No tipo `Props`, acrescentar `className?: string;` e desestruturar `className` na assinatura: `export function TodayStrip({ medications, selectedId, onSelect, className }: Props) {`.
3. Trocar a abertura `<section className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col gap-3 text-start">` por:

```tsx
        <section className={cn("glass rounded-[24px] p-5 flex flex-col gap-3 text-start", className)}>
```

4. No `<h2>`, acrescentar `m-0` à `className`.

- [ ] **Step 6: Substituir `src/pages/dashboard.tsx` inteiro por**

```tsx
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import { CalendarCheck, Flame, Plus, TrendingUp, TriangleAlert } from "lucide-react";
import type { Medication } from "../types/medType";
import { API_URL } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import { formatTimeUntilNextDose } from "../lib/formatTimeUntilNextDose";
import { Button } from "../components/button";
import { buttonClasses } from "../components/buttonStyles";
import { GlassCard } from "../components/glassCard";
import { StatCard } from "../components/statCard";
import { TodayStrip } from "../components/todayStrip";
import { TodaySchedule } from "../components/todaySchedule";
import { HistoryCard } from "../components/historyCard";
import { TreatmentSummaryDialog } from "../components/treatmentSummaryDialog";

type Stats = {
    currentStreak: number;
    dosesTaken: number;
    weeklyAdherenceRate: number;
    missedDoses: number;
    missedByMedication: { medicationId: number; missedCount: number }[];
};

type DashboardStats = {
    overall: Stats;
    perMedication: Record<string, Stats>;
};

function greetingFor(date: Date): string {
    const hour = date.getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
}

export function Dashboard() {
    const navigate = useNavigate();
    const { data: session } = authClient.useSession();
    const [medications, setMedications] = useState<Medication[]>([]);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [activeMedicationIndex, setActiveMedicationIndex] = useState(0);
    const [undoTarget, setUndoTarget] = useState<Medication | null>(null);
    const [isUndoing, setIsUndoing] = useState(false);
    const [isDismissingSummary, setIsDismissingSummary] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const fetchMedications = async () => {
        try {
            const response = await fetch(`${API_URL}/medications`, {
                method: 'GET',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to fetch medications');
            const responseData = await response.json();
            setMedications(responseData.data);
        } catch (error) {
            console.error('Error fetching medications:', error);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await fetch(`${API_URL}/stats`, {
                method: 'GET',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to fetch stats');
            const responseData = await response.json();
            setStats(responseData.data);
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    useEffect(() => {
        fetchMedications();
        fetchStats();
    }, []);

    const sortedMedications = medications
        .filter((m) => !m.completed)
        .sort((a, b) => {
            if (!a.nextDoseAt) return 1;
            if (!b.nextDoseAt) return -1;
            return new Date(a.nextDoseAt).getTime() - new Date(b.nextDoseAt).getTime();
        });

    // One summary popup at a time; the next one shows after this is dismissed.
    const summaryTarget = medications.find((m) => m.treatmentSummary && !m.treatmentSummary.dismissed) ?? null;

    // The list shrinks when a treatment completes, so keep the index inside it.
    const activeMedication = sortedMedications[Math.min(activeMedicationIndex, sortedMedications.length - 1)] ?? null;

    // History shows the strip's selection, defaulting to the first active medication.
    const historyId = selectedId ?? (sortedMedications[0]?.id ?? medications[0]?.id ?? null);
    const historyMedication = medications.find((m) => String(m.id) === String(historyId)) ?? null;

    const scheduledToday = medications.filter((m) => !m.completed && (m.today?.expected ?? 0) > 0);
    const dosesExpectedToday = scheduledToday.reduce((sum, m) => sum + (m.today?.expected ?? 0), 0);
    const dosesTakenToday = scheduledToday.reduce(
        (sum, m) => sum + Math.min(m.today?.taken ?? 0, m.today?.expected ?? 0),
        0,
    );

    const handleTakeMedication = async (medId: string) => {
        try {
            const response = await fetch(`${API_URL}/medication/${medId}/take`, {
                method: "POST",
                credentials: 'include',
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                console.error('Erro ao confirmar dose:', data?.error ?? response.status);
                return;
            }
            fetchMedications();
            fetchStats();
        } catch (error) {
            console.error(error);
        }
    };

    const handleUndoMedication = async (medId: string) => {
        setIsUndoing(true);
        try {
            const response = await fetch(`${API_URL}/medication/${medId}/take`, {
                method: "DELETE",
                credentials: 'include',
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                console.error('Erro ao desfazer dose:', data?.error ?? response.status);
                return;
            }
            fetchMedications();
            fetchStats();
        } catch (error) {
            console.error(error);
        } finally {
            setIsUndoing(false);
            setUndoTarget(null);
        }
    };

    const handleDismissSummary = async (medId: string) => {
        setIsDismissingSummary(true);
        try {
            const response = await fetch(`${API_URL}/medications/${medId}/summary/dismiss`, {
                method: "POST",
                credentials: 'include',
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                console.error('Erro ao dispensar resumo:', data?.error ?? response.status);
                return;
            }
            await fetchMedications();
        } catch (error) {
            console.error(error);
        } finally {
            setIsDismissingSummary(false);
        }
    };

    const openReminder = () => {
        if (activeMedication) navigate("/reminder", { state: { medication: activeMedication } });
    };

    const timeUntilNextDose = formatTimeUntilNextDose(activeMedication?.nextDoseAt ?? null);

    const canTakeMedicationNow = (med: Medication) =>
        !med.lastTakenAt || !med.nextDoseAt || new Date(med.nextDoseAt).getTime() <= Date.now();

    const now = new Date();
    const firstName = session?.user?.name?.split(" ")[0] ?? "...";
    const todayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

    return (
        <main className="flex min-h-screen flex-col gap-5 p-5 text-start lg:min-h-0 lg:p-0">
            <header className="flex items-end justify-between gap-4 pt-6 lg:pt-2">
                <div>
                    <p className="text-sm capitalize text-gray-500">{todayLabel}</p>
                    <h1 className="m-0 font-heading text-3xl font-semibold tracking-tight text-gray-900 lg:text-4xl">
                        {greetingFor(now)}, {firstName}
                    </h1>
                </div>
                <Link to="/add" className={buttonClasses("primary", "hidden lg:inline-flex")}>
                    <Plus className="size-[18px]" />
                    Adicionar remédio
                </Link>
            </header>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <StatCard
                    icon={CalendarCheck}
                    label="Doses de hoje"
                    value={`${dosesTakenToday}/${dosesExpectedToday}`}
                    hint={timeUntilNextDose ? `Próxima em ${timeUntilNextDose}` : undefined}
                    tone="lime"
                />
                <StatCard
                    icon={TrendingUp}
                    label="Adesão da semana"
                    value={`${stats?.overall.weeklyAdherenceRate ?? 0}%`}
                    tone="mint"
                />
                <StatCard
                    icon={Flame}
                    label="Sequência"
                    value={`${stats?.overall.currentStreak ?? 0} ${stats?.overall.currentStreak === 1 ? "dia" : "dias"}`}
                    tone="amber"
                />
                <StatCard
                    icon={TriangleAlert}
                    label="Doses perdidas"
                    value={`${stats?.overall.missedDoses ?? 0}`}
                    hint="Últimos 7 dias"
                    tone="rose"
                />
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
                <GlassCard className="flex flex-col lg:col-span-7">
                    <h2 className="m-0 mb-3 text-lg font-semibold text-gray-900">Próxima dose</h2>
                    {sortedMedications.length > 0 ? (
                        <Swiper
                            modules={[Pagination]}
                            pagination={{ clickable: true }}
                            onSlideChange={(swiper) => setActiveMedicationIndex(swiper.activeIndex)}
                            className="w-full"
                            style={{ paddingBottom: '2rem' }}
                        >
                            {sortedMedications.map((med) => (
                                <SwiperSlide key={med.id}>
                                    <button onClick={openReminder} className="mb-4 flex w-full items-center gap-4 text-left">
                                        <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-3xl ${getMedicationVisual(med.category as MedicationCategory).bgClass}`}>
                                            {getMedicationVisual(med.category as MedicationCategory).emoji}
                                        </div>
                                        <div className="flex flex-1 flex-col items-start">
                                            <h3 className="m-0 text-2xl font-semibold text-gray-900">{med.name}</h3>
                                            <div className="mt-1 flex gap-6">
                                                <div>
                                                    <p className="text-xs text-gray-500">Dosagem</p>
                                                    <p className="text-xl font-medium text-gray-800">{med.dosage}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-gray-500">Horário</p>
                                                    <p className="text-xl font-medium text-gray-800">
                                                        {med.nextDoseAt
                                                            ? new Date(med.nextDoseAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                                            : "Aguardando"
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                    {med.lastTakenAt && (
                                        <p className="-mt-2 mb-3 text-xs text-gray-500">
                                            Última dose: {new Date(med.lastTakenAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    )}
                                    <Button
                                        variant={canTakeMedicationNow(med) ? "primary" : "secondary"}
                                        onClick={() => handleTakeMedication(med.id)}
                                        disabled={!canTakeMedicationNow(med)}
                                        className="w-full"
                                    >
                                        {canTakeMedicationNow(med) ? "Confirmar dose" : "Próxima dose ainda não disponível"}
                                    </Button>
                                    {med.lastTakenAt && (
                                        <button
                                            onClick={() => setUndoTarget(med)}
                                            className="mt-2 w-full text-center text-sm text-gray-500 underline"
                                        >
                                            Marquei por engano? Desfazer última dose
                                        </button>
                                    )}
                                </SwiperSlide>
                            ))}
                        </Swiper>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-gray-900/15 p-6 text-center">
                            <p className="mb-4 text-gray-500">Você não tem remédios pendentes.</p>
                            <Link to="/add" className={buttonClasses("secondary")}>Adicionar remédio</Link>
                        </div>
                    )}
                </GlassCard>

                <TodaySchedule className="lg:col-span-5" medications={medications} />

                {medications.length > 0 && (
                    <>
                        <TodayStrip
                            className="lg:col-span-5"
                            medications={medications}
                            selectedId={historyId}
                            onSelect={setSelectedId}
                        />
                        <HistoryCard className="lg:col-span-7" medication={historyMedication} selectedId={historyId} />
                    </>
                )}
            </div>

            {summaryTarget?.treatmentSummary && (
                <TreatmentSummaryDialog
                    medicationName={summaryTarget.name}
                    summary={summaryTarget.treatmentSummary}
                    isDismissing={isDismissingSummary}
                    onDismiss={() => handleDismissSummary(summaryTarget.id)}
                />
            )}

            {undoTarget && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 p-6 backdrop-blur-sm"
                    onClick={() => !isUndoing && setUndoTarget(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="undo-dose-title"
                        className="glass-strong flex w-full max-w-sm flex-col gap-4 rounded-[24px] p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 id="undo-dose-title" className="m-0 text-lg font-semibold text-gray-900">
                            Desfazer última dose?
                        </h2>
                        <p className="text-gray-600">
                            O registro da última dose de <strong>{undoTarget.name}</strong> será removido.
                        </p>
                        <div className="flex gap-3">
                            <Button variant="outline" className="flex-1" onClick={() => setUndoTarget(null)} disabled={isUndoing}>
                                Não
                            </Button>
                            <Button className="flex-1" onClick={() => handleUndoMedication(undoTarget.id)} disabled={isUndoing}>
                                Sim
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
```

- [ ] **Step 7: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/hooks/useMedicationHistory.ts src/components/historyCard.tsx src/components/statCard.tsx src/components/todaySchedule.tsx src/components/todayStrip.tsx src/pages/dashboard.tsx`
Expected: build sem erros; no eslint, só os 2 erros já conhecidos em `dashboard.tsx` (`set-state-in-effect` no `useEffect` e `purity` em `Date.now`), nada novo. Se aparecer `purity` também para `new Date()` no render (`const now = new Date()`), relatar — não reestruturar.

- [ ] **Step 8: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/hooks/useMedicationHistory.ts src/components/historyCard.tsx src/components/statCard.tsx src/components/todaySchedule.tsx src/components/todayStrip.tsx src/pages/dashboard.tsx
git commit -m "feat: dashboard com indicadores, agenda de hoje e histórico em grade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lista, Progresso, Perfil, Lembrete e diálogo de resumo

**Files:** `src/pages/medicationList.tsx`, `src/pages/progress.tsx`, `src/pages/profile.tsx`, `src/pages/reminder.tsx`, `src/components/treatmentSummaryDialog.tsx`.

**Interfaces:** Consumes `GlassCard`, `inputClasses`, `buttonClasses`, `HistoryCard`, `TodayStrip` (Tasks 1 e 5).

Regras: não mudar lógica, `placeholder`s, `aria-*` nem textos. Trocar só classes/estrutura conforme abaixo.

- [ ] **Step 1: `medicationList.tsx`**
1. `<div>` raiz: trocar `"flex flex-col bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen items-center justify-start w-full px-4 gap-4 pt-15"` por `"flex min-h-screen w-full flex-col gap-4 px-5 pt-10 text-start lg:min-h-0 lg:px-0 lg:pt-2"`.
2. Logo no topo dessa `<div>`, antes da busca, acrescentar: `<h1 className="m-0 font-heading text-3xl font-semibold tracking-tight text-gray-900">Remédios</h1>`.
3. Ícone da busca: acrescentar `size-[18px] text-gray-400` (trocar `opacity-50` por `text-gray-400`); o `Input` da busca já recebe `pl-11` — manter.
4. Botões de filtro (Todos e categorias): trocar `bg-white text-gray-500` (inativo) por `glass text-gray-600` e manter o ativo `bg-primary text-primary-foreground`; acrescentar `h-9` e manter `rounded-full px-4`.
5. Card de remédio: trocar `"flex p-4 rounded-3xl shadow gap-3 relative bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md"` por `"glass relative flex gap-3 rounded-[24px] p-4"`.
6. Menu de opções do card (`absolute right-0 top-8 ... bg-white rounded-xl shadow-lg border border-gray-100 ...`): trocar `bg-white rounded-xl shadow-lg border border-gray-100` por `glass-strong rounded-2xl`.
7. Botão flutuante `+` (o `<Link to="/add">` com o ícone `Plus` fixo): acrescentar `lg:hidden` à `className` do `<Link>` (o desktop tem o botão no menu lateral). Se a classe estiver no `Plus`, envolver: `<Link to="/add" className="lg:hidden">`.
8. Diálogo de exclusão: fundo `bg-black/40` → `bg-gray-900/30 backdrop-blur-sm`; card `bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl` → `glass-strong rounded-[24px] p-6 w-full max-w-sm`.

- [ ] **Step 2: `progress.tsx`**
1. `<main>`: trocar `"bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 flex flex-col gap-6"` por `"flex min-h-screen flex-col gap-5 p-5 text-start lg:min-h-0 lg:p-0"`.
2. `<h1>`: trocar por `className="m-0 pt-6 font-heading text-3xl font-semibold tracking-tight text-gray-900 lg:pt-2 lg:text-4xl"`.
3. Remover o estado e o efeito de histórico (`history`, `historyError`, o `useEffect` que busca `/medications/${selectedId}/history`, `handleSelect`, `historyIsCurrent`) e usar o `HistoryCard`:
   - imports: remover `MedicationHistory` e `AdherenceHeatmap`; acrescentar `import { HistoryCard } from "../components/historyCard";`.
   - `TodayStrip` recebe `onSelect={setSelectedId}`.
   - Substituir a `<section>` de histórico inteira por `<HistoryCard medication={selectedMedication} selectedId={selectedId} />`.
   - Envolver `TodayStrip` e `HistoryCard` num `<div className="grid gap-5 lg:grid-cols-12">`, com `className="lg:col-span-5"` no `TodayStrip` e `className="lg:col-span-7"` no `HistoryCard`.
4. Aviso de lista vazia e de "Nenhuma dose registrada": trocar `bg-white p-6 rounded-[24px] text-center border border-dashed border-gray-300` por `glass rounded-[24px] p-6 text-center`.
5. Itens da linha do tempo: trocar `bg-white/70 rounded-2xl p-3 shadow-[0_4px_20px_rgba(0,0,0,0.05)]` por `glass rounded-2xl p-3`.

- [ ] **Step 3: `profile.tsx`**
1. `<main>`: trocar `"bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 flex flex-col gap-6"` por `"flex min-h-screen flex-col gap-5 p-5 text-start lg:min-h-0 lg:p-0"`; `<h1>` igual ao do Step 2.2.
2. Todos os cards `bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)]` (com `rounded-[24px]` ou `rounded-[20px]`) → `glass rounded-[24px]` mantendo os demais utilitários de layout (`p-4`, `flex`, `gap-*`...).
3. Os dois `<select>` (antecedência do lembrete e fuso horário): trocar a `className` deles por `inputClasses` (importar `import { inputClasses } from "@/components/ui/input";` — ou do arquivo `inputClasses.ts`, se a Task 1 o tiver movido), mantendo `mt-2` no do fuso: ``className={`${inputClasses} mt-2`}``.
4. Desktop em duas colunas: envolver o card do nome/avatar e a lista de cards de configurações num `<div className="grid gap-5 lg:grid-cols-2 lg:items-start">` (o card do usuário à esquerda, a coluna de configurações à direita). O botão "Sair" fica abaixo da grade.

- [ ] **Step 4: `reminder.tsx`**
1. `<main>`: trocar `bg-white` por nada (o fundo de manchas aparece) e acrescentar `py-10`.
2. Envolver o conteúdo interno (do `timeLabel` até os botões) num `<GlassCard className="glass-strong flex w-full max-w-md flex-col items-center gap-8 p-8">` importando `GlassCard`.

- [ ] **Step 5: `treatmentSummaryDialog.tsx`**
1. Fundo: `bg-black/40` → `bg-gray-900/30 backdrop-blur-sm`.
2. Card: trocar `rounded-[24px] bg-white p-6 shadow-xl` por `glass-strong rounded-[24px] p-6`.
3. Bloco do placar `rounded-2xl bg-gray-50 p-4 text-center` → `rounded-2xl bg-white/60 p-4 text-center`.
4. `<h2>`: acrescentar `m-0`.

- [ ] **Step 6: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/medicationList.tsx src/pages/progress.tsx src/pages/profile.tsx src/pages/reminder.tsx src/components/treatmentSummaryDialog.tsx`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/pages/medicationList.tsx src/pages/progress.tsx src/pages/profile.tsx src/pages/reminder.tsx src/components/treatmentSummaryDialog.tsx
git commit -m "feat: lista, progresso, perfil e lembrete com o visual novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Revisão visual (controlador)

Não delegar.

- [ ] Subir API (`.env` = produção; testes com conta `teste-visual-*@example.com`, autorizado pelo Pedro, apagada no fim) e frontend (`npm run dev`, proxy `/backend`).
- [ ] Com Playwright, em 390×844 e 1440×900: onboarding, login, cadastro, dashboard (com 3 remédios: um tomado, um pendente, um semanal sem dose hoje), lista, cadastro de remédio (os três tipos de frequência), progresso, perfil, lembrete e o diálogo de desfazer. Conferir os prints: nada cortado, nada centralizado por engano, vidro legível sobre as manchas, menu lateral só no desktop, barra inferior só no celular.
- [ ] Corrigir o que estiver feio ou quebrado; mostrar os prints principais ao Pedro antes do push.
- [ ] Apagar a conta de teste (listando antes), parar servidores, push da `main`.

---

## Self-review (spec × plano)

| Requisito | Onde |
|---|---|
| Tema claro, remover CSS do template | Task 1 step 1 |
| Manchas verdes fixas | Task 1 step 2 |
| Vidro (`glass`/`glass-strong`) | Task 1 step 1, usado em 2–6 |
| Inputs novos com rótulo/ícone/erro | Task 1 steps 5–6; usados em 3, 4, 6 |
| Controles segmentados | Task 1 step 7; Task 4 |
| Botões novos | Task 1 step 4 |
| Menu lateral desktop / barra inferior celular | Task 2 |
| Dashboard: saudação, 4 indicadores, Próxima dose 7/12, Agenda 5/12, Hoje 5/12, Histórico 7/12 | Task 5 |
| Login/cadastro em duas colunas no desktop | Task 3 |
| Formulário em duas colunas no desktop | Task 4 |
| Lista em grade, "+" só no celular; perfil em duas colunas; progresso; lembrete | Task 6 |
| Prints em celular e desktop antes de publicar | Task 7 |

Observação: o card antigo "Streak de Remédios" do dashboard (sequência e doses por remédio, com barras) é substituído pelos 4 indicadores gerais, como na referência.
