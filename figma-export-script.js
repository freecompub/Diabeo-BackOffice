/**
 * Diabeo BackOffice — Figma Plugin Script
 *
 * Ce script cree le design system complet + les 4 ecrans dans Figma.
 *
 * COMMENT L'UTILISER :
 * 1. Ouvre le fichier DiabeoWeb dans Figma
 * 2. Menu > Plugins > Development > Open Console
 * 3. Colle ce script entier dans la console et appuie sur Entree
 *
 * Le script va creer :
 * - Page "Design System" : palette couleurs, typographie, composants de base
 * - Page "Login & Dashboard" : ecran login + dashboard glycemie
 * - Page "Patients" : liste patients + detail patient
 *
 * NOTE : Les collections de variables Brand Colors et Clinical Colors
 * ont deja ete creees via MCP. Ce script ajoute UI Semantic + les ecrans.
 */

// ============================================================
// HELPERS
// ============================================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

function hexToRgba(hex, a = 1) {
  return { ...hexToRgb(hex), a };
}

function fill(hex) {
  return [{ type: "SOLID", color: hexToRgb(hex) }];
}

function fillOpacity(hex, opacity) {
  return [{ type: "SOLID", color: hexToRgb(hex), opacity }];
}

async function loadFont(family, style) {
  await figma.loadFontAsync({ family, style });
}

async function createText(text, opts = {}) {
  const family = opts.family || "Inter";
  const style = opts.style || "Regular";
  await loadFont(family, style);

  const node = figma.createText();
  node.fontName = { family, style };
  node.characters = text;
  if (opts.size) node.fontSize = opts.size;
  if (opts.color) node.fills = fill(opts.color);
  if (opts.lineHeight) {
    node.lineHeight = { unit: "PIXELS", value: opts.lineHeight };
  }
  if (opts.letterSpacing) {
    node.letterSpacing = { unit: "PIXELS", value: opts.letterSpacing };
  }
  return node;
}

function createAutoFrame(name, opts = {}) {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = opts.direction || "VERTICAL";
  frame.primaryAxisSizingMode = opts.primarySizing || "AUTO";
  frame.counterAxisSizingMode = opts.counterSizing || "AUTO";
  frame.itemSpacing = opts.gap ?? 16;
  frame.paddingTop = opts.paddingY ?? opts.padding ?? 0;
  frame.paddingBottom = opts.paddingY ?? opts.padding ?? 0;
  frame.paddingLeft = opts.paddingX ?? opts.padding ?? 0;
  frame.paddingRight = opts.paddingX ?? opts.padding ?? 0;
  frame.fills = opts.fills ?? [];
  if (opts.cornerRadius) frame.cornerRadius = opts.cornerRadius;
  return frame;
}

function addShadow(node, offsetY = 4, blur = 12, color = "#000000", opacity = 0.08) {
  node.effects = [{
    type: "DROP_SHADOW",
    color: { ...hexToRgb(color), a: opacity },
    offset: { x: 0, y: offsetY },
    radius: blur,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
  }];
}

function createIcon(letter, size = 20, bgColor = "#0D9488", textColor = "#FFFFFF") {
  const frame = figma.createFrame();
  frame.name = "Icon";
  frame.resize(size, size);
  frame.cornerRadius = size * 0.25;
  frame.fills = fill(bgColor);
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.primaryAxisSizingMode = "FIXED";
  frame.counterAxisSizingMode = "FIXED";
  return frame;
}

// ============================================================
// PART 1 — UI SEMANTIC VARIABLES (completes the design system)
// ============================================================

async function createUiSemanticVariables() {
  const collection = figma.variables.createVariableCollection("UI Semantic");
  const modeId = collection.modes[0].modeId;

  const colors = {
    "UI/Background": "#FAFAFA",
    "UI/Foreground": "#1F2937",
    "UI/Card": "#FFFFFF",
    "UI/Card Foreground": "#1F2937",
    "UI/Primary": "#0D9488",
    "UI/Primary Foreground": "#FFFFFF",
    "UI/Secondary": "#F3F4F6",
    "UI/Secondary Foreground": "#1F2937",
    "UI/Muted": "#F3F4F6",
    "UI/Muted Foreground": "#6B7280",
    "UI/Accent": "#F97316",
    "UI/Accent Foreground": "#FFFFFF",
    "UI/Destructive": "#EF4444",
    "UI/Border": "#E5E7EB",
    "UI/Input": "#E5E7EB",
    "UI/Ring": "#0D9488",
    "Sidebar/Background": "#FFFFFF",
    "Sidebar/Foreground": "#1F2937",
    "Sidebar/Primary": "#0D9488",
    "Sidebar/Primary Foreground": "#FFFFFF",
    "Sidebar/Accent": "#F3F4F6",
    "Sidebar/Border": "#E5E7EB",
  };

  for (const [name, hex] of Object.entries(colors)) {
    const v = figma.variables.createVariable(name, collection, "COLOR");
    v.setValueForMode(modeId, hexToRgb(hex));
    v.scopes = name.includes("Foreground") ? ["TEXT_FILL"] :
               name.includes("Border") || name.includes("Input") ? ["STROKE_COLOR"] :
               ["FRAME_FILL", "SHAPE_FILL"];
  }

  return collection.id;
}

// ============================================================
// PART 2 — DESIGN SYSTEM PAGE (color swatches + typography)
// ============================================================

async function buildDesignSystemPage() {
  const page = figma.root.children.find(p => p.name.includes("Design System"));
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  // --- Color Palette Section ---
  const paletteSection = createAutoFrame("Color Palette", { gap: 32, padding: 40, fills: fill("#FFFFFF") });
  paletteSection.resize(1400, 10);
  paletteSection.primaryAxisSizingMode = "AUTO";
  paletteSection.counterAxisSizingMode = "FIXED";

  const paletteTitle = await createText("Palette de couleurs — Serenite Active", { size: 28, style: "Bold", color: "#1F2937" });
  paletteSection.appendChild(paletteTitle);

  // Color groups
  const colorGroups = {
    "Primary — Teal": {
      "50": "#F0FDFA", "100": "#CCFBF1", "200": "#99F6E4", "300": "#5EEAD4",
      "400": "#2DD4BF", "500": "#14B8A6", "600": "#0D9488", "700": "#0F766E",
      "800": "#115E59", "900": "#134E4A", "950": "#042F2E",
    },
    "Secondary — Coral": {
      "50": "#FFF7ED", "100": "#FFEDD5", "200": "#FED7AA", "300": "#FDBA74",
      "400": "#FB923C", "500": "#F97316", "600": "#EA580C", "700": "#C2410C",
      "800": "#9A3412", "900": "#7C2D12", "950": "#431407",
    },
    "Neutral — Gray": {
      "50": "#FAFAFA", "100": "#F3F4F6", "200": "#E5E7EB", "300": "#D1D5DB",
      "400": "#9CA3AF", "500": "#6B7280", "600": "#4B5563", "700": "#374151",
      "800": "#1F2937", "900": "#111827", "950": "#030712",
    },
  };

  for (const [groupName, shades] of Object.entries(colorGroups)) {
    const groupFrame = createAutoFrame(groupName, { gap: 12 });
    const groupTitle = await createText(groupName, { size: 16, style: "Semi Bold", color: "#1F2937" });
    groupFrame.appendChild(groupTitle);

    const swatchRow = createAutoFrame(groupName + " Swatches", { direction: "HORIZONTAL", gap: 8 });

    for (const [shade, hex] of Object.entries(shades)) {
      const swatchFrame = createAutoFrame("Swatch " + shade, { gap: 4, padding: 0 });
      const rect = figma.createRectangle();
      rect.name = shade;
      rect.resize(80, 56);
      rect.cornerRadius = 8;
      rect.fills = fill(hex);
      addShadow(rect, 1, 3, "#000000", 0.06);
      swatchFrame.appendChild(rect);

      const label = await createText(shade, { size: 11, color: "#6B7280" });
      swatchFrame.appendChild(label);
      const hexLabel = await createText(hex, { size: 10, color: "#9CA3AF" });
      swatchFrame.appendChild(hexLabel);

      swatchRow.appendChild(swatchFrame);
    }
    groupFrame.appendChild(swatchRow);
    paletteSection.appendChild(groupFrame);
  }

  // --- Clinical Colors ---
  const clinicalTitle = await createText("Couleurs cliniques — Glycemie", { size: 16, style: "Semi Bold", color: "#1F2937" });
  paletteSection.appendChild(clinicalTitle);

  const clinicalRow = createAutoFrame("Clinical Swatches", { direction: "HORIZONTAL", gap: 12 });
  const clinicalColors = {
    "Very Low\n<54 mg/dL": "#991B1B",
    "Low\n54-69": "#EF4444",
    "Normal\n70-180": "#10B981",
    "High\n181-250": "#F59E0B",
    "Very High\n>250": "#EF4444",
    "Critical\n<40 / >400": "#DC2626",
  };

  for (const [label, hex] of Object.entries(clinicalColors)) {
    const swatchFrame = createAutoFrame("Clinical " + label, { gap: 6, padding: 0 });
    const rect = figma.createRectangle();
    rect.resize(100, 56);
    rect.cornerRadius = 8;
    rect.fills = fill(hex);
    swatchFrame.appendChild(rect);
    const txt = await createText(label, { size: 11, color: "#374151" });
    swatchFrame.appendChild(txt);
    clinicalRow.appendChild(swatchFrame);
  }
  paletteSection.appendChild(clinicalRow);

  // --- Pathology badges ---
  const pathoTitle = await createText("Pathologies", { size: 16, style: "Semi Bold", color: "#1F2937" });
  paletteSection.appendChild(pathoTitle);

  const pathoRow = createAutoFrame("Pathology Badges", { direction: "HORIZONTAL", gap: 12 });
  const pathologies = { "DT1 — Type 1": "#7C3AED", "DT2 — Type 2": "#2563EB", "GD — Gestationnel": "#EC4899" };

  for (const [label, hex] of Object.entries(pathologies)) {
    const badge = createAutoFrame(label, { direction: "HORIZONTAL", gap: 6, paddingX: 12, paddingY: 6, fills: fillOpacity(hex, 0.1) });
    badge.cornerRadius = 999;
    const dot = figma.createEllipse();
    dot.resize(8, 8);
    dot.fills = fill(hex);
    badge.appendChild(dot);
    const txt = await createText(label, { size: 12, style: "Medium", color: hex });
    badge.appendChild(txt);
    pathoRow.appendChild(badge);
  }
  paletteSection.appendChild(pathoRow);

  // Position the section
  paletteSection.x = 0;
  paletteSection.y = 0;

  // --- Typography Section ---
  const typoSection = createAutoFrame("Typography", { gap: 24, padding: 40, fills: fill("#FFFFFF") });
  typoSection.resize(1400, 10);
  typoSection.primaryAxisSizingMode = "AUTO";
  typoSection.counterAxisSizingMode = "FIXED";
  typoSection.x = 0;
  typoSection.y = paletteSection.height + 60;

  const typoTitle = await createText("Typographie — Diabeo", { size: 28, style: "Bold", color: "#1F2937" });
  typoSection.appendChild(typoTitle);

  const typeSizes = [
    { name: "4xl — 36px", size: 36, style: "Bold", sample: "Titre principal (H1)" },
    { name: "3xl — 30px", size: 30, style: "Bold", sample: "Titre section (H2)" },
    { name: "2xl — 24px", size: 24, style: "Semi Bold", sample: "Sous-titre (H3)" },
    { name: "xl — 20px", size: 20, style: "Semi Bold", sample: "Titre carte (H4)" },
    { name: "lg — 18px", size: 18, style: "Medium", sample: "Texte important" },
    { name: "md — 16px", size: 16, style: "Regular", sample: "Texte standard" },
    { name: "base — 14px (default body)", size: 14, style: "Regular", sample: "Corps de texte par defaut dans l'application Diabeo BackOffice" },
    { name: "sm — 13px", size: 13, style: "Regular", sample: "Texte secondaire, labels" },
    { name: "xs — 12px", size: 12, style: "Regular", sample: "Texte auxiliaire, timestamps" },
  ];

  for (const t of typeSizes) {
    const row = createAutoFrame(t.name, { gap: 4 });
    const label = await createText(t.name, { size: 12, style: "Medium", color: "#6B7280" });
    row.appendChild(label);
    const sample = await createText(t.sample, { size: t.size, style: t.style, color: "#1F2937" });
    row.appendChild(sample);
    typoSection.appendChild(row);
  }

  // Font weights demo
  const weightsTitle = await createText("Graisses", { size: 16, style: "Semi Bold", color: "#1F2937" });
  typoSection.appendChild(weightsTitle);

  const weightsRow = createAutoFrame("Weights", { direction: "HORIZONTAL", gap: 24 });
  const weights = [
    { label: "Regular 400", style: "Regular" },
    { label: "Medium 500", style: "Medium" },
    { label: "Semi Bold 600", style: "Semi Bold" },
    { label: "Bold 700", style: "Bold" },
  ];

  for (const w of weights) {
    const wt = await createText(w.label, { size: 16, style: w.style, color: "#1F2937" });
    weightsRow.appendChild(wt);
  }
  typoSection.appendChild(weightsRow);
}

// ============================================================
// PART 3 — LOGIN SCREEN
// ============================================================

async function buildLoginScreen() {
  const page = figma.root.children.find(p => p.name.includes("Login"));
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  // Full screen container (1440x900)
  const screen = figma.createFrame();
  screen.name = "Login — 1440x900";
  screen.resize(1440, 900);
  screen.fills = fill("#FAFAFA");
  screen.layoutMode = "VERTICAL";
  screen.primaryAxisAlignItems = "CENTER";
  screen.counterAxisAlignItems = "CENTER";
  screen.primaryAxisSizingMode = "FIXED";
  screen.counterAxisSizingMode = "FIXED";

  // Content wrapper (centered)
  const content = createAutoFrame("Login Content", { gap: 0, padding: 0 });
  content.resize(380, 10);
  content.primaryAxisSizingMode = "AUTO";
  content.counterAxisSizingMode = "FIXED";
  content.counterAxisAlignItems = "CENTER";
  content.itemSpacing = 0;

  // Logo
  const logoFrame = createAutoFrame("Logo Section", { gap: 12, padding: 0 });
  logoFrame.counterAxisAlignItems = "CENTER";

  const logoIcon = figma.createFrame();
  logoIcon.name = "Logo";
  logoIcon.resize(56, 56);
  logoIcon.cornerRadius = 16;
  logoIcon.fills = fill("#0D9488");
  addShadow(logoIcon, 4, 12, "#0D9488", 0.25);
  logoIcon.layoutMode = "VERTICAL";
  logoIcon.primaryAxisAlignItems = "CENTER";
  logoIcon.counterAxisAlignItems = "CENTER";
  logoIcon.primaryAxisSizingMode = "FIXED";
  logoIcon.counterAxisSizingMode = "FIXED";

  const logoLetter = await createText("D", { size: 24, style: "Bold", color: "#FFFFFF" });
  logoIcon.appendChild(logoLetter);
  logoFrame.appendChild(logoIcon);

  const welcomeText = await createText("Bienvenue sur Diabeo", { size: 24, style: "Semi Bold", color: "#1F2937" });
  logoFrame.appendChild(welcomeText);
  const subtitleText = await createText("Votre espace de gestion de l'insulinotherapie", { size: 14, color: "#6B7280" });
  logoFrame.appendChild(subtitleText);

  content.appendChild(logoFrame);

  // Spacer
  const spacer1 = figma.createFrame();
  spacer1.name = "Spacer";
  spacer1.resize(10, 32);
  spacer1.fills = [];
  content.appendChild(spacer1);

  // Card
  const card = createAutoFrame("Login Card", { gap: 16, paddingX: 24, paddingY: 24, fills: fill("#FFFFFF"), cornerRadius: 12 });
  card.resize(380, 10);
  card.counterAxisSizingMode = "FIXED";
  card.primaryAxisSizingMode = "AUTO";
  addShadow(card, 4, 16, "#000000", 0.08);

  // Email field
  const emailField = createAutoFrame("Email Field", { gap: 6 });
  emailField.resize(332, 10);
  emailField.counterAxisSizingMode = "FIXED";
  const emailLabel = await createText("Adresse email", { size: 14, style: "Medium", color: "#374151" });
  emailField.appendChild(emailLabel);
  const emailInput = figma.createFrame();
  emailInput.name = "Input";
  emailInput.resize(332, 40);
  emailInput.cornerRadius = 8;
  emailInput.fills = fill("#FFFFFF");
  emailInput.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  emailInput.strokeWeight = 1;
  emailInput.layoutMode = "HORIZONTAL";
  emailInput.counterAxisAlignItems = "CENTER";
  emailInput.paddingLeft = 12;
  emailInput.paddingRight = 12;
  emailInput.primaryAxisSizingMode = "FIXED";
  emailInput.counterAxisSizingMode = "FIXED";
  const emailPlaceholder = await createText("docteur@hopital.fr", { size: 14, color: "#9CA3AF" });
  emailInput.appendChild(emailPlaceholder);
  emailField.appendChild(emailInput);
  card.appendChild(emailField);

  // Password field
  const passwordField = createAutoFrame("Password Field", { gap: 6 });
  passwordField.resize(332, 10);
  passwordField.counterAxisSizingMode = "FIXED";
  const passwordLabel = await createText("Mot de passe", { size: 14, style: "Medium", color: "#374151" });
  passwordField.appendChild(passwordLabel);
  const passwordInput = figma.createFrame();
  passwordInput.name = "Input";
  passwordInput.resize(332, 40);
  passwordInput.cornerRadius = 8;
  passwordInput.fills = fill("#FFFFFF");
  passwordInput.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  passwordInput.strokeWeight = 1;
  passwordInput.layoutMode = "HORIZONTAL";
  passwordInput.counterAxisAlignItems = "CENTER";
  passwordInput.paddingLeft = 12;
  passwordInput.paddingRight = 12;
  passwordInput.primaryAxisSizingMode = "FIXED";
  passwordInput.counterAxisSizingMode = "FIXED";
  const passPlaceholder = await createText("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", { size: 14, color: "#9CA3AF" });
  passwordInput.appendChild(passPlaceholder);
  passwordField.appendChild(passwordInput);
  card.appendChild(passwordField);

  // Submit button
  const submitBtn = figma.createFrame();
  submitBtn.name = "Button — Se connecter";
  submitBtn.resize(332, 44);
  submitBtn.cornerRadius = 8;
  submitBtn.fills = fill("#0D9488");
  submitBtn.layoutMode = "HORIZONTAL";
  submitBtn.primaryAxisAlignItems = "CENTER";
  submitBtn.counterAxisAlignItems = "CENTER";
  submitBtn.primaryAxisSizingMode = "FIXED";
  submitBtn.counterAxisSizingMode = "FIXED";
  const btnText = await createText("Se connecter", { size: 14, style: "Semi Bold", color: "#FFFFFF" });
  submitBtn.appendChild(btnText);
  card.appendChild(submitBtn);

  // Forgot password
  const forgotLink = await createText("Mot de passe oublie ?", { size: 13, color: "#0D9488" });
  card.appendChild(forgotLink);
  card.counterAxisAlignItems = "CENTER";

  content.appendChild(card);

  // Footer
  const spacer2 = figma.createFrame();
  spacer2.name = "Spacer";
  spacer2.resize(10, 24);
  spacer2.fills = [];
  content.appendChild(spacer2);

  const footerFrame = createAutoFrame("Footer", { gap: 8 });
  footerFrame.counterAxisAlignItems = "CENTER";
  const noAccountText = await createText("Pas encore de compte ?", { size: 13, color: "#6B7280" });
  footerFrame.appendChild(noAccountText);
  const createAccountLink = await createText("Creer un compte", { size: 13, style: "Medium", color: "#0D9488" });
  footerFrame.appendChild(createAccountLink);
  content.appendChild(footerFrame);

  const hdsFooter = await createText("Diabeo — Heberge sur infrastructure certifiee HDS", { size: 11, color: "#9CA3AF" });
  content.appendChild(hdsFooter);

  screen.appendChild(content);
  screen.x = 0;
  screen.y = 0;

  return screen.id;
}

// ============================================================
// PART 4 — DASHBOARD SCREEN (with sidebar)
// ============================================================

async function buildDashboardScreen() {
  const page = figma.root.children.find(p => p.name.includes("Login"));
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  const screen = figma.createFrame();
  screen.name = "Dashboard — 1440x900";
  screen.resize(1440, 900);
  screen.fills = fill("#FAFAFA");
  screen.layoutMode = "HORIZONTAL";
  screen.primaryAxisSizingMode = "FIXED";
  screen.counterAxisSizingMode = "FIXED";

  // --- Sidebar ---
  const sidebar = createAutoFrame("Sidebar", { gap: 0, padding: 0, fills: fill("#FFFFFF") });
  sidebar.resize(256, 900);
  sidebar.primaryAxisSizingMode = "FIXED";
  sidebar.counterAxisSizingMode = "FIXED";
  sidebar.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  sidebar.strokeWeight = 1;
  sidebar.strokeAlign = "INSIDE";

  // Sidebar logo
  const sidebarHeader = createAutoFrame("Sidebar Header", { direction: "HORIZONTAL", gap: 12, paddingX: 24, paddingY: 16 });
  sidebarHeader.resize(256, 64);
  sidebarHeader.counterAxisSizingMode = "FIXED";
  sidebarHeader.primaryAxisSizingMode = "FIXED";
  sidebarHeader.counterAxisAlignItems = "CENTER";
  sidebarHeader.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  sidebarHeader.strokeWeight = 1;
  sidebarHeader.strokeAlign = "INSIDE";

  const sLogo = figma.createFrame();
  sLogo.name = "Logo";
  sLogo.resize(32, 32);
  sLogo.cornerRadius = 8;
  sLogo.fills = fill("#0D9488");
  sLogo.layoutMode = "VERTICAL";
  sLogo.primaryAxisAlignItems = "CENTER";
  sLogo.counterAxisAlignItems = "CENTER";
  sLogo.primaryAxisSizingMode = "FIXED";
  sLogo.counterAxisSizingMode = "FIXED";
  const sLogoText = await createText("D", { size: 14, style: "Bold", color: "#FFFFFF" });
  sLogo.appendChild(sLogoText);
  sidebarHeader.appendChild(sLogo);
  const sTitle = await createText("Diabeo", { size: 18, style: "Semi Bold", color: "#1F2937" });
  sidebarHeader.appendChild(sTitle);
  sidebar.appendChild(sidebarHeader);

  // Sidebar nav items
  const navSection = createAutoFrame("Nav Items", { gap: 4, paddingX: 12, paddingY: 16 });
  navSection.resize(256, 10);
  navSection.counterAxisSizingMode = "FIXED";

  const navItems = [
    { label: "Tableau de bord", active: true },
    { label: "Patients", active: false },
    { label: "Medicaments", active: false },
    { label: "Analytics", active: false },
    { label: "Documents", active: false },
    { label: "Parametres", active: false },
  ];

  for (const item of navItems) {
    const navItem = createAutoFrame(item.label, {
      direction: "HORIZONTAL", gap: 12, paddingX: 12, paddingY: 10,
      fills: item.active ? fillOpacity("#0D9488", 0.08) : [],
      cornerRadius: 8,
    });
    navItem.resize(232, 10);
    navItem.counterAxisSizingMode = "FIXED";
    navItem.counterAxisAlignItems = "CENTER";

    // Icon placeholder
    const iconDot = figma.createRectangle();
    iconDot.resize(20, 20);
    iconDot.cornerRadius = 4;
    iconDot.fills = fillOpacity(item.active ? "#0D9488" : "#9CA3AF", 0.3);
    navItem.appendChild(iconDot);

    const navLabel = await createText(item.label, {
      size: 14, style: "Medium",
      color: item.active ? "#0D9488" : "#6B7280"
    });
    navItem.appendChild(navLabel);
    navSection.appendChild(navItem);
  }
  sidebar.appendChild(navSection);

  screen.appendChild(sidebar);

  // --- Main content ---
  const main = createAutoFrame("Main Content", { gap: 0, padding: 0, fills: fill("#FAFAFA") });
  main.resize(1184, 900);
  main.primaryAxisSizingMode = "FIXED";
  main.counterAxisSizingMode = "FIXED";

  // Header bar
  const header = createAutoFrame("Header", { direction: "HORIZONTAL", paddingX: 24, paddingY: 12, fills: fill("#FFFFFF"), gap: 16 });
  header.resize(1184, 56);
  header.counterAxisSizingMode = "FIXED";
  header.primaryAxisSizingMode = "FIXED";
  header.counterAxisAlignItems = "CENTER";
  header.strokes = [{ type: "SOLID", color: hexToRgb("#F3F4F6") }];
  header.strokeWeight = 1;

  const headerTitle = await createText("Suivi glycemique", { size: 18, style: "Semi Bold", color: "#111827" });
  header.appendChild(headerTitle);

  // Period pills
  const periodPills = createAutoFrame("Period Selector", { direction: "HORIZONTAL", gap: 4, fills: fill("#F3F4F6"), cornerRadius: 8, paddingX: 4, paddingY: 4 });
  const periods = ["1S", "2S", "1M", "3M"];
  for (const p of periods) {
    const pill = createAutoFrame(p, {
      paddingX: 12, paddingY: 6, cornerRadius: 6,
      fills: p === "2S" ? fill("#FFFFFF") : [],
    });
    if (p === "2S") addShadow(pill, 1, 2, "#000000", 0.05);
    const pillText = await createText(p, { size: 12, style: "Medium", color: p === "2S" ? "#0D9488" : "#6B7280" });
    pill.appendChild(pillText);
    periodPills.appendChild(pill);
  }
  header.appendChild(periodPills);

  // New event button
  const newEventBtn = figma.createFrame();
  newEventBtn.name = "Button — Nouvel evenement";
  newEventBtn.layoutMode = "HORIZONTAL";
  newEventBtn.primaryAxisAlignItems = "CENTER";
  newEventBtn.counterAxisAlignItems = "CENTER";
  newEventBtn.paddingLeft = 16;
  newEventBtn.paddingRight = 16;
  newEventBtn.paddingTop = 8;
  newEventBtn.paddingBottom = 8;
  newEventBtn.cornerRadius = 8;
  newEventBtn.fills = fill("#0D9488");
  newEventBtn.itemSpacing = 8;
  newEventBtn.primaryAxisSizingMode = "AUTO";
  newEventBtn.counterAxisSizingMode = "AUTO";
  const plusText = await createText("+", { size: 16, style: "Bold", color: "#FFFFFF" });
  newEventBtn.appendChild(plusText);
  const newEvtLabel = await createText("Nouvel evenement", { size: 13, style: "Semi Bold", color: "#FFFFFF" });
  newEventBtn.appendChild(newEvtLabel);
  header.appendChild(newEventBtn);

  main.appendChild(header);

  // Body
  const body = createAutoFrame("Body", { gap: 24, paddingX: 24, paddingY: 24 });
  body.resize(1184, 10);
  body.counterAxisSizingMode = "FIXED";

  // Metrics grid (6 cards)
  const metricsTitle = await createText("Donnees resumees", { size: 16, style: "Semi Bold", color: "#1F2937" });
  body.appendChild(metricsTitle);

  const metricsGrid = createAutoFrame("Metrics Grid", { direction: "HORIZONTAL", gap: 16 });

  const metrics = [
    { label: "Glucose moyen", value: "158", unit: "mg/dL", color: "#F59E0B" },
    { label: "HbA1c estimee", value: "7.1", unit: "%", color: "#0D9488" },
    { label: "TIR", value: "75", unit: "%", color: "#10B981" },
    { label: "CV", value: "34.2", unit: "%", color: "#10B981" },
    { label: "Ecart-type", value: "54", unit: "mg/dL", color: "#6B7280" },
    { label: "Hypoglycemies", value: "3", unit: "evenements", color: "#EF4444" },
  ];

  for (const m of metrics) {
    const metricCard = createAutoFrame(m.label, { gap: 8, paddingX: 16, paddingY: 16, fills: fill("#FFFFFF"), cornerRadius: 12 });
    metricCard.resize(168, 10);
    metricCard.counterAxisSizingMode = "FIXED";
    addShadow(metricCard, 1, 4, "#000000", 0.04);

    const mLabel = await createText(m.label, { size: 12, color: "#6B7280" });
    metricCard.appendChild(mLabel);
    const mValue = await createText(m.value, { size: 28, style: "Bold", color: m.color });
    metricCard.appendChild(mValue);
    const mUnit = await createText(m.unit, { size: 12, color: "#9CA3AF" });
    metricCard.appendChild(mUnit);

    metricsGrid.appendChild(metricCard);
  }
  body.appendChild(metricsGrid);

  // Chart placeholder
  const chartCard = createAutoFrame("CGM Chart", { gap: 12, paddingX: 20, paddingY: 20, fills: fill("#FFFFFF"), cornerRadius: 12 });
  chartCard.resize(1136, 320);
  chartCard.counterAxisSizingMode = "FIXED";
  chartCard.primaryAxisSizingMode = "FIXED";
  addShadow(chartCard, 1, 4, "#000000", 0.04);

  // Target range band
  const chartArea = figma.createFrame();
  chartArea.name = "Chart Area";
  chartArea.resize(1096, 240);
  chartArea.fills = fill("#FAFAFA");
  chartArea.cornerRadius = 8;

  // Target range rectangle
  const targetRange = figma.createRectangle();
  targetRange.name = "Target Range 70-180";
  targetRange.resize(1096, 100);
  targetRange.y = 60;
  targetRange.fills = fillOpacity("#10B981", 0.08);
  chartArea.appendChild(targetRange);

  // Simulated CGM line (wave)
  const chartLine = figma.createRectangle();
  chartLine.name = "CGM Trace (placeholder)";
  chartLine.resize(1096, 3);
  chartLine.y = 100;
  chartLine.fills = fill("#0D9488");
  chartLine.cornerRadius = 2;
  chartArea.appendChild(chartLine);

  // Labels
  const label180 = await createText("180 mg/dL", { size: 10, color: "#10B981" });
  label180.x = 8;
  label180.y = 56;
  chartArea.appendChild(label180);
  const label70 = await createText("70 mg/dL", { size: 10, color: "#EF4444" });
  label70.x = 8;
  label70.y = 162;
  chartArea.appendChild(label70);

  chartCard.appendChild(chartArea);
  body.appendChild(chartCard);

  main.appendChild(body);
  screen.appendChild(main);

  screen.x = 0;
  screen.y = 960;

  return screen.id;
}

// ============================================================
// PART 5 — PATIENT LIST SCREEN
// ============================================================

async function buildPatientListScreen() {
  const page = figma.root.children.find(p => p.name.includes("Patients"));
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  const screen = figma.createFrame();
  screen.name = "Patient List — 1440x900";
  screen.resize(1440, 900);
  screen.fills = fill("#FAFAFA");
  screen.layoutMode = "HORIZONTAL";
  screen.primaryAxisSizingMode = "FIXED";
  screen.counterAxisSizingMode = "FIXED";

  // --- Reuse sidebar structure ---
  const sidebar = createAutoFrame("Sidebar", { gap: 0, padding: 0, fills: fill("#FFFFFF") });
  sidebar.resize(256, 900);
  sidebar.primaryAxisSizingMode = "FIXED";
  sidebar.counterAxisSizingMode = "FIXED";
  sidebar.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  sidebar.strokeWeight = 1;

  const sidebarHeader = createAutoFrame("Sidebar Header", { direction: "HORIZONTAL", gap: 12, paddingX: 24, paddingY: 16 });
  sidebarHeader.resize(256, 64);
  sidebarHeader.counterAxisSizingMode = "FIXED";
  sidebarHeader.primaryAxisSizingMode = "FIXED";
  sidebarHeader.counterAxisAlignItems = "CENTER";
  sidebarHeader.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  sidebarHeader.strokeWeight = 1;

  const sLogo = figma.createFrame();
  sLogo.resize(32, 32);
  sLogo.cornerRadius = 8;
  sLogo.fills = fill("#0D9488");
  sLogo.layoutMode = "VERTICAL";
  sLogo.primaryAxisAlignItems = "CENTER";
  sLogo.counterAxisAlignItems = "CENTER";
  sLogo.primaryAxisSizingMode = "FIXED";
  sLogo.counterAxisSizingMode = "FIXED";
  const sLogoT = await createText("D", { size: 14, style: "Bold", color: "#FFFFFF" });
  sLogo.appendChild(sLogoT);
  sidebarHeader.appendChild(sLogo);
  const sTitle = await createText("Diabeo", { size: 18, style: "Semi Bold", color: "#1F2937" });
  sidebarHeader.appendChild(sTitle);
  sidebar.appendChild(sidebarHeader);

  const navSection = createAutoFrame("Nav Items", { gap: 4, paddingX: 12, paddingY: 16 });
  navSection.resize(256, 10);
  navSection.counterAxisSizingMode = "FIXED";
  const navItems = [
    { label: "Tableau de bord", active: false },
    { label: "Patients", active: true },
    { label: "Medicaments", active: false },
    { label: "Analytics", active: false },
    { label: "Documents", active: false },
    { label: "Parametres", active: false },
  ];
  for (const item of navItems) {
    const navItem = createAutoFrame(item.label, {
      direction: "HORIZONTAL", gap: 12, paddingX: 12, paddingY: 10,
      fills: item.active ? fillOpacity("#0D9488", 0.08) : [],
      cornerRadius: 8,
    });
    navItem.resize(232, 10);
    navItem.counterAxisSizingMode = "FIXED";
    navItem.counterAxisAlignItems = "CENTER";
    const iconRect = figma.createRectangle();
    iconRect.resize(20, 20);
    iconRect.cornerRadius = 4;
    iconRect.fills = fillOpacity(item.active ? "#0D9488" : "#9CA3AF", 0.3);
    navItem.appendChild(iconRect);
    const navLabel = await createText(item.label, { size: 14, style: "Medium", color: item.active ? "#0D9488" : "#6B7280" });
    navItem.appendChild(navLabel);
    navSection.appendChild(navItem);
  }
  sidebar.appendChild(navSection);
  screen.appendChild(sidebar);

  // --- Main content ---
  const main = createAutoFrame("Main", { gap: 0, padding: 0, fills: fill("#FAFAFA") });
  main.resize(1184, 900);
  main.primaryAxisSizingMode = "FIXED";
  main.counterAxisSizingMode = "FIXED";

  // Header
  const header = createAutoFrame("Header", { direction: "HORIZONTAL", paddingX: 24, paddingY: 16, gap: 4, fills: fill("#FFFFFF") });
  header.resize(1184, 10);
  header.counterAxisSizingMode = "FIXED";

  const headerLeft = createAutoFrame("Header Left", { gap: 2 });
  const hTitle = await createText("Patients", { size: 20, style: "Semi Bold", color: "#1F2937" });
  headerLeft.appendChild(hTitle);
  const hSub = await createText("8 patients", { size: 13, color: "#6B7280" });
  headerLeft.appendChild(hSub);
  header.appendChild(headerLeft);
  main.appendChild(header);

  // Search + filters
  const toolbar = createAutoFrame("Toolbar", { direction: "HORIZONTAL", gap: 12, paddingX: 24, paddingY: 16 });
  toolbar.resize(1184, 10);
  toolbar.counterAxisSizingMode = "FIXED";
  toolbar.counterAxisAlignItems = "CENTER";

  const searchInput = figma.createFrame();
  searchInput.name = "Search";
  searchInput.resize(320, 40);
  searchInput.cornerRadius = 8;
  searchInput.fills = fill("#FFFFFF");
  searchInput.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  searchInput.strokeWeight = 1;
  searchInput.layoutMode = "HORIZONTAL";
  searchInput.counterAxisAlignItems = "CENTER";
  searchInput.paddingLeft = 12;
  searchInput.primaryAxisSizingMode = "FIXED";
  searchInput.counterAxisSizingMode = "FIXED";
  const searchPlaceholder = await createText("Rechercher un patient...", { size: 14, color: "#9CA3AF" });
  searchInput.appendChild(searchPlaceholder);
  toolbar.appendChild(searchInput);

  // Filter pills
  const filterPills = createAutoFrame("Filters", { direction: "HORIZONTAL", gap: 6 });
  const filters = ["Tous", "DT1", "DT2", "GD"];
  for (const f of filters) {
    const pill = createAutoFrame(f, {
      paddingX: 12, paddingY: 6, cornerRadius: 999,
      fills: f === "Tous" ? fill("#0D9488") : fill("#F3F4F6"),
    });
    const pillTxt = await createText(f, { size: 12, style: "Medium", color: f === "Tous" ? "#FFFFFF" : "#6B7280" });
    pill.appendChild(pillTxt);
    filterPills.appendChild(pill);
  }
  toolbar.appendChild(filterPills);
  main.appendChild(toolbar);

  // Patient table
  const tableCard = createAutoFrame("Patient Table", { gap: 0, padding: 0, fills: fill("#FFFFFF"), cornerRadius: 12 });
  tableCard.resize(1136, 10);
  tableCard.counterAxisSizingMode = "FIXED";
  tableCard.x = 24;
  addShadow(tableCard, 1, 4, "#000000", 0.04);

  // Table header
  const tableHeader = createAutoFrame("Table Header", { direction: "HORIZONTAL", gap: 0, paddingX: 16, paddingY: 12 });
  tableHeader.resize(1136, 10);
  tableHeader.counterAxisSizingMode = "FIXED";
  tableHeader.counterAxisAlignItems = "CENTER";
  tableHeader.fills = fill("#F9FAFB");

  const colWidths = { "Patient": 220, "Pathologie": 120, "Age": 80, "Derniere glycemie": 160, "TIR": 160, "Derniere sync": 120, "": 40 };
  for (const [col, w] of Object.entries(colWidths)) {
    if (!col) continue;
    const colFrame = createAutoFrame(col, { paddingX: 8 });
    colFrame.resize(w, 10);
    colFrame.counterAxisSizingMode = "FIXED";
    const colText = await createText(col, { size: 12, style: "Medium", color: "#6B7280" });
    colFrame.appendChild(colText);
    tableHeader.appendChild(colFrame);
  }
  tableCard.appendChild(tableHeader);

  // Table rows
  const patients = [
    { name: "Patient DT1-001", patho: "DT1", pathoColor: "#7C3AED", age: "34 ans", glucose: "127", glucoseColor: "#10B981", tir: "75%", tirQ: "Excellent", lastSync: "2h" },
    { name: "Patient DT2-002", patho: "DT2", pathoColor: "#2563EB", age: "58 ans", glucose: "195", glucoseColor: "#F59E0B", tir: "52%", tirQ: "Bon", lastSync: "30min" },
    { name: "Patient DT1-003", patho: "DT1", pathoColor: "#7C3AED", age: "27 ans", glucose: "98", glucoseColor: "#10B981", tir: "82%", tirQ: "Excellent", lastSync: "15min" },
    { name: "Patient DT1-004", patho: "DT1", pathoColor: "#7C3AED", age: "41 ans", glucose: "256", glucoseColor: "#EF4444", tir: "38%", tirQ: "Modere", lastSync: "1h" },
    { name: "Patient GD-005", patho: "GD", pathoColor: "#EC4899", age: "32 ans", glucose: "112", glucoseColor: "#10B981", tir: "71%", tirQ: "Excellent", lastSync: "45min" },
    { name: "Patient DT2-006", patho: "DT2", pathoColor: "#2563EB", age: "63 ans", glucose: "68", glucoseColor: "#EF4444", tir: "55%", tirQ: "Bon", lastSync: "3h" },
    { name: "Patient DT1-007", patho: "DT1", pathoColor: "#7C3AED", age: "19 ans", glucose: "145", glucoseColor: "#10B981", tir: "67%", tirQ: "Bon", lastSync: "20min" },
    { name: "Patient DT2-008", patho: "DT2", pathoColor: "#2563EB", age: "55 ans", glucose: "—", glucoseColor: "#9CA3AF", tir: "—", tirQ: "", lastSync: "7j" },
  ];

  for (let i = 0; i < patients.length; i++) {
    const p = patients[i];
    const row = createAutoFrame("Row " + p.name, { direction: "HORIZONTAL", gap: 0, paddingX: 16, paddingY: 14 });
    row.resize(1136, 10);
    row.counterAxisSizingMode = "FIXED";
    row.counterAxisAlignItems = "CENTER";
    if (i < patients.length - 1) {
      row.strokes = [{ type: "SOLID", color: hexToRgb("#F3F4F6") }];
      row.strokeWeight = 1;
      row.strokeAlign = "INSIDE";
    }

    // Patient name
    const nameCell = createAutoFrame("Name", { paddingX: 8 });
    nameCell.resize(220, 10);
    nameCell.counterAxisSizingMode = "FIXED";
    const nameText = await createText(p.name, { size: 14, style: "Medium", color: "#1F2937" });
    nameCell.appendChild(nameText);
    row.appendChild(nameCell);

    // Pathology badge
    const pathoCell = createAutoFrame("Patho", { paddingX: 8 });
    pathoCell.resize(120, 10);
    pathoCell.counterAxisSizingMode = "FIXED";
    const pathoBadge = createAutoFrame(p.patho, {
      direction: "HORIZONTAL", gap: 4, paddingX: 8, paddingY: 4,
      fills: fillOpacity(p.pathoColor, 0.1), cornerRadius: 999,
    });
    const pathoText = await createText(p.patho, { size: 11, style: "Semi Bold", color: p.pathoColor });
    pathoBadge.appendChild(pathoText);
    pathoCell.appendChild(pathoBadge);
    row.appendChild(pathoCell);

    // Age
    const ageCell = createAutoFrame("Age", { paddingX: 8 });
    ageCell.resize(80, 10);
    ageCell.counterAxisSizingMode = "FIXED";
    const ageText = await createText(p.age, { size: 13, color: "#6B7280" });
    ageCell.appendChild(ageText);
    row.appendChild(ageCell);

    // Glucose
    const glucoseCell = createAutoFrame("Glucose", { paddingX: 8 });
    glucoseCell.resize(160, 10);
    glucoseCell.counterAxisSizingMode = "FIXED";
    const glucoseText = await createText(p.glucose === "—" ? "—" : p.glucose + " mg/dL", { size: 14, style: "Semi Bold", color: p.glucoseColor });
    glucoseCell.appendChild(glucoseText);
    row.appendChild(glucoseCell);

    // TIR
    const tirCell = createAutoFrame("TIR", { direction: "HORIZONTAL", gap: 8, paddingX: 8 });
    tirCell.resize(160, 10);
    tirCell.counterAxisSizingMode = "FIXED";
    tirCell.counterAxisAlignItems = "CENTER";
    const tirText = await createText(p.tir, { size: 14, style: "Medium", color: "#1F2937" });
    tirCell.appendChild(tirText);
    if (p.tirQ) {
      const qColor = p.tirQ === "Excellent" ? "#10B981" : p.tirQ === "Bon" ? "#F59E0B" : "#EF4444";
      const qBadge = createAutoFrame(p.tirQ, { paddingX: 6, paddingY: 2, fills: fillOpacity(qColor, 0.1), cornerRadius: 4 });
      const qText = await createText(p.tirQ, { size: 11, style: "Medium", color: qColor });
      qBadge.appendChild(qText);
      tirCell.appendChild(qBadge);
    }
    row.appendChild(tirCell);

    // Last sync
    const syncCell = createAutoFrame("Sync", { paddingX: 8 });
    syncCell.resize(120, 10);
    syncCell.counterAxisSizingMode = "FIXED";
    const syncText = await createText(p.lastSync, { size: 13, color: "#6B7280" });
    syncCell.appendChild(syncText);
    row.appendChild(syncCell);

    // Chevron
    const chevronCell = createAutoFrame("Action", { paddingX: 8 });
    chevronCell.resize(40, 10);
    chevronCell.counterAxisSizingMode = "FIXED";
    const chevron = await createText(">", { size: 14, color: "#9CA3AF" });
    chevronCell.appendChild(chevron);
    row.appendChild(chevronCell);

    tableCard.appendChild(row);
  }

  // Need to add table after toolbar — use absolute positioning workaround
  const tableWrapper = createAutoFrame("Table Wrapper", { gap: 0, paddingX: 24 });
  tableWrapper.resize(1184, 10);
  tableWrapper.counterAxisSizingMode = "FIXED";
  tableWrapper.appendChild(tableCard);
  main.appendChild(tableWrapper);

  screen.appendChild(main);
  screen.x = 0;
  screen.y = 0;
}

// ============================================================
// PART 6 — PATIENT DETAIL SCREEN
// ============================================================

async function buildPatientDetailScreen() {
  const page = figma.root.children.find(p => p.name.includes("Patients"));
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  const screen = figma.createFrame();
  screen.name = "Patient Detail — 1440x900";
  screen.resize(1440, 960);
  screen.fills = fill("#FAFAFA");
  screen.layoutMode = "HORIZONTAL";
  screen.primaryAxisSizingMode = "FIXED";
  screen.counterAxisSizingMode = "FIXED";

  // Mini sidebar (same structure, "Patients" active)
  const sidebar = createAutoFrame("Sidebar", { gap: 0, padding: 0, fills: fill("#FFFFFF") });
  sidebar.resize(256, 960);
  sidebar.primaryAxisSizingMode = "FIXED";
  sidebar.counterAxisSizingMode = "FIXED";
  sidebar.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  sidebar.strokeWeight = 1;

  const sidebarHeader = createAutoFrame("Sidebar Header", { direction: "HORIZONTAL", gap: 12, paddingX: 24, paddingY: 16 });
  sidebarHeader.resize(256, 64);
  sidebarHeader.counterAxisSizingMode = "FIXED";
  sidebarHeader.primaryAxisSizingMode = "FIXED";
  sidebarHeader.counterAxisAlignItems = "CENTER";
  const sLogo = figma.createFrame();
  sLogo.resize(32, 32);
  sLogo.cornerRadius = 8;
  sLogo.fills = fill("#0D9488");
  sLogo.layoutMode = "VERTICAL";
  sLogo.primaryAxisAlignItems = "CENTER";
  sLogo.counterAxisAlignItems = "CENTER";
  sLogo.primaryAxisSizingMode = "FIXED";
  sLogo.counterAxisSizingMode = "FIXED";
  const slt = await createText("D", { size: 14, style: "Bold", color: "#FFFFFF" });
  sLogo.appendChild(slt);
  sidebarHeader.appendChild(sLogo);
  const stit = await createText("Diabeo", { size: 18, style: "Semi Bold", color: "#1F2937" });
  sidebarHeader.appendChild(stit);
  sidebar.appendChild(sidebarHeader);
  screen.appendChild(sidebar);

  // Main
  const main = createAutoFrame("Main", { gap: 0, padding: 0, fills: fill("#FAFAFA") });
  main.resize(1184, 960);
  main.primaryAxisSizingMode = "FIXED";
  main.counterAxisSizingMode = "FIXED";

  // Header
  const header = createAutoFrame("Header", { gap: 2, paddingX: 24, paddingY: 16, fills: fill("#FFFFFF") });
  header.resize(1184, 10);
  header.counterAxisSizingMode = "FIXED";
  const hTitle = await createText("Patient DT1-001", { size: 20, style: "Semi Bold", color: "#1F2937" });
  header.appendChild(hTitle);
  const hSub = await createText("DT1 — 34 ans — Service diabetologie — CH Demo", { size: 13, color: "#6B7280" });
  header.appendChild(hSub);
  main.appendChild(header);

  // Tabs
  const tabs = createAutoFrame("Tabs", { direction: "HORIZONTAL", gap: 0, paddingX: 24, fills: fill("#FFFFFF") });
  tabs.resize(1184, 10);
  tabs.counterAxisSizingMode = "FIXED";
  const tabItems = ["Vue d'ensemble", "Glycemie", "Traitements", "Documents"];
  for (const tab of tabItems) {
    const tabFrame = createAutoFrame(tab, { paddingX: 16, paddingY: 12 });
    const isActive = tab === "Vue d'ensemble";
    if (isActive) {
      tabFrame.strokes = [{ type: "SOLID", color: hexToRgb("#0D9488") }];
      tabFrame.strokeWeight = 2;
      tabFrame.strokeAlign = "INSIDE";
    }
    const tabText = await createText(tab, { size: 14, style: isActive ? "Semi Bold" : "Regular", color: isActive ? "#0D9488" : "#6B7280" });
    tabFrame.appendChild(tabText);
    tabs.appendChild(tabFrame);
  }
  main.appendChild(tabs);

  // Body
  const body = createAutoFrame("Body", { gap: 24, paddingX: 24, paddingY: 24 });
  body.resize(1184, 10);
  body.counterAxisSizingMode = "FIXED";

  // KPI Row (4 cards)
  const kpiRow = createAutoFrame("KPI Row", { direction: "HORIZONTAL", gap: 16 });

  const kpis = [
    { label: "Glycemie actuelle", value: "127", unit: "mg/dL", color: "#10B981" },
    { label: "TIR (7j)", value: "75%", unit: "", color: "#10B981" },
    { label: "GMI", value: "7.1%", unit: "", color: "#0D9488" },
    { label: "CV", value: "34.2%", unit: "", color: "#10B981" },
  ];

  for (const k of kpis) {
    const card = createAutoFrame(k.label, { gap: 6, paddingX: 20, paddingY: 16, fills: fill("#FFFFFF"), cornerRadius: 12 });
    card.resize(270, 10);
    card.counterAxisSizingMode = "FIXED";
    addShadow(card, 1, 4, "#000000", 0.04);
    const kLabel = await createText(k.label, { size: 12, color: "#6B7280" });
    card.appendChild(kLabel);
    const valRow = createAutoFrame("Val", { direction: "HORIZONTAL", gap: 4 });
    valRow.counterAxisAlignItems = "MAX";
    const kVal = await createText(k.value, { size: 28, style: "Bold", color: k.color });
    valRow.appendChild(kVal);
    if (k.unit) {
      const kUnit = await createText(k.unit, { size: 13, color: "#9CA3AF" });
      valRow.appendChild(kUnit);
    }
    card.appendChild(valRow);
  }

  for (const k of kpis) {
    const card = createAutoFrame(k.label, { gap: 6, paddingX: 20, paddingY: 16, fills: fill("#FFFFFF"), cornerRadius: 12 });
    card.resize(270, 10);
    card.counterAxisSizingMode = "FIXED";
    addShadow(card, 1, 4, "#000000", 0.04);
    const kLabel = await createText(k.label, { size: 12, color: "#6B7280" });
    card.appendChild(kLabel);
    const kVal = await createText(k.value, { size: 28, style: "Bold", color: k.color });
    card.appendChild(kVal);
    if (k.unit) {
      const kUnit = await createText(k.unit, { size: 13, color: "#9CA3AF" });
      card.appendChild(kUnit);
    }
    kpiRow.appendChild(card);
  }
  body.appendChild(kpiRow);

  // Profile + TIR row
  const profileRow = createAutoFrame("Profile + TIR", { direction: "HORIZONTAL", gap: 24 });

  // Profile card
  const profileCard = createAutoFrame("Profil patient", { gap: 16, paddingX: 24, paddingY: 20, fills: fill("#FFFFFF"), cornerRadius: 12 });
  profileCard.resize(740, 10);
  profileCard.counterAxisSizingMode = "FIXED";
  addShadow(profileCard, 1, 4, "#000000", 0.04);

  const pcTitle = await createText("Profil patient", { size: 16, style: "Semi Bold", color: "#1F2937" });
  profileCard.appendChild(pcTitle);

  const profileGrid = createAutoFrame("Profile Grid", { direction: "HORIZONTAL", gap: 24 });
  const profileCol1 = createAutoFrame("Col1", { gap: 16 });
  const profileCol2 = createAutoFrame("Col2", { gap: 16 });

  const fields = [
    ["Pathologie", "DT1"], ["Diagnostic", "2015"],
    ["Sexe", "Femme"], ["Age", "34 ans"],
    ["Medecin referent", "CH Demo"], ["Glycemie moyenne (14j)", "158 mg/dL"],
  ];

  for (let i = 0; i < fields.length; i++) {
    const [label, value] = fields[i];
    const fieldFrame = createAutoFrame(label, { gap: 4 });
    const fLabel = await createText(label, { size: 12, color: "#6B7280" });
    fieldFrame.appendChild(fLabel);
    const fValue = await createText(value, { size: 14, style: "Medium", color: "#1F2937" });
    fieldFrame.appendChild(fValue);
    (i % 2 === 0 ? profileCol1 : profileCol2).appendChild(fieldFrame);
  }
  profileGrid.appendChild(profileCol1);
  profileGrid.appendChild(profileCol2);
  profileCard.appendChild(profileGrid);

  // Objectives
  const objTitle = await createText("Objectifs glycemiques", { size: 12, color: "#6B7280" });
  profileCard.appendChild(objTitle);
  const objRow = createAutoFrame("Objectives", { direction: "HORIZONTAL", gap: 8 });
  const objectives = ["Cible : 70-180 mg/dL", "TIR cible : 70%", "Hypo max : 4%"];
  for (const obj of objectives) {
    const badge = createAutoFrame(obj, {
      paddingX: 10, paddingY: 4, cornerRadius: 6,
      fills: [],
    });
    badge.strokes = [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
    badge.strokeWeight = 1;
    const badgeText = await createText(obj, { size: 12, color: "#374151" });
    badge.appendChild(badgeText);
    objRow.appendChild(badge);
  }
  profileCard.appendChild(objRow);
  profileRow.appendChild(profileCard);

  // TIR Donut card
  const tirCard = createAutoFrame("TIR Card", { gap: 16, paddingX: 24, paddingY: 20, fills: fill("#FFFFFF"), cornerRadius: 12 });
  tirCard.resize(372, 10);
  tirCard.counterAxisSizingMode = "FIXED";
  tirCard.counterAxisAlignItems = "CENTER";
  addShadow(tirCard, 1, 4, "#000000", 0.04);

  const tirTitle = await createText("TIR (7 jours)", { size: 16, style: "Semi Bold", color: "#1F2937" });
  tirCard.appendChild(tirTitle);

  // Donut placeholder (concentric rings)
  const donutFrame = figma.createFrame();
  donutFrame.name = "TIR Donut";
  donutFrame.resize(180, 180);
  donutFrame.fills = [];

  const outerRing = figma.createEllipse();
  outerRing.resize(180, 180);
  outerRing.fills = fill("#10B981"); // In range (75%)
  donutFrame.appendChild(outerRing);

  const middleRing = figma.createEllipse();
  middleRing.resize(140, 140);
  middleRing.x = 20;
  middleRing.y = 20;
  middleRing.fills = fill("#F59E0B"); // High (17%)
  donutFrame.appendChild(middleRing);

  const innerRing = figma.createEllipse();
  innerRing.resize(100, 100);
  innerRing.x = 40;
  innerRing.y = 40;
  innerRing.fills = fill("#FFFFFF");
  donutFrame.appendChild(innerRing);

  const centerText = await createText("75%", { size: 28, style: "Bold", color: "#10B981" });
  centerText.x = 60;
  centerText.y = 72;
  donutFrame.appendChild(centerText);

  tirCard.appendChild(donutFrame);

  // TIR legend
  const legend = createAutoFrame("Legend", { gap: 8 });
  const zones = [
    { label: "En cible (70-180)", pct: "75%", color: "#10B981" },
    { label: "Haut (181-250)", pct: "17%", color: "#F59E0B" },
    { label: "Tres haut (>250)", pct: "4%", color: "#F97316" },
    { label: "Bas (54-69)", pct: "3%", color: "#EF4444" },
    { label: "Tres bas (<54)", pct: "1%", color: "#991B1B" },
  ];

  for (const z of zones) {
    const zRow = createAutoFrame(z.label, { direction: "HORIZONTAL", gap: 8 });
    zRow.counterAxisAlignItems = "CENTER";
    const dot = figma.createEllipse();
    dot.resize(8, 8);
    dot.fills = fill(z.color);
    zRow.appendChild(dot);
    const zLabel = await createText(z.label, { size: 12, color: "#374151" });
    zRow.appendChild(zLabel);
    const zPct = await createText(z.pct, { size: 12, style: "Semi Bold", color: "#1F2937" });
    zRow.appendChild(zPct);
    legend.appendChild(zRow);
  }
  tirCard.appendChild(legend);
  profileRow.appendChild(tirCard);

  body.appendChild(profileRow);
  main.appendChild(body);
  screen.appendChild(main);

  screen.x = 0;
  screen.y = 960;
}

// ============================================================
// MAIN — Execute all parts
// ============================================================

(async () => {
  try {
    // Part 1: UI Semantic variables
    await createUiSemanticVariables();

    // Part 2: Design System page
    await buildDesignSystemPage();

    // Part 3: Login screen
    await buildLoginScreen();

    // Part 4: Dashboard screen
    await buildDashboardScreen();

    // Part 5: Patient list
    await buildPatientListScreen();

    // Part 6: Patient detail
    await buildPatientDetailScreen();

    figma.notify("Diabeo Design System + 4 ecrans exportes avec succes !");
  } catch (err) {
    figma.notify("Erreur: " + err.message, { error: true });
    console.error(err);
  }
})();
