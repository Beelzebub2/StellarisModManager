# 🛸 Stellaris Mod Manager — Plano de Desenvolvimento

> App desktop cross-platform em **Avalonia UI** (.NET / C#) para gerir mods do Steam Workshop sem precisar do Steam.

---

## Stack Tecnológica

| Camada | Tecnologia | Porquê |
|---|---|---|
| UI Framework | **Avalonia UI 11** | Cross-platform, moderno, XAML-based, tema escuro nativo |
| Linguagem | **C# / .NET 8** | Ecossistema robusto, async/await, fácil deploy |
| WebView | **WebView2 (via Avalonia.WebView)** | Renderizar Steam Workshop dentro da app |
| Download | **SteamCMD** (integrado) ou **SteamWebAPI** | Download direto dos ficheiros do Workshop |
| Base de dados local | **SQLite + EF Core** | Guardar mods instalados, versões, load order |
| Injeção de overlay | **JavaScript injection via WebView2** | Botão "Download" sobre cada mod na Workshop |
| Packaging | **single-file publish** (.exe) | Fácil distribuição sem instalador |

---

## Arquitetura da App

```
StellarisModManager/
├── Core/
│   ├── Models/
│   │   ├── Mod.cs                  # ID, nome, versão, path, ativo
│   │   ├── ModProfile.cs           # Load order salva
│   │   └── GameInstall.cs          # Caminho do jogo, pasta mod
│   ├── Services/
│   │   ├── WorkshopDownloader.cs   # SteamCMD wrapper / HTTP fallback
│   │   ├── ModInstaller.cs         # Copia ficheiros + gera .mod file
│   │   ├── ModDatabase.cs          # SQLite CRUD
│   │   └── ParadoxLauncher.cs      # Integração com launcher (playset)
│   └── Utils/
│       └── OverlayInjector.cs      # JS injection no WebView
│
├── UI/
│   ├── Views/
│   │   ├── MainWindow.axaml        # Shell principal com sidebar
│   │   ├── BrowserView.axaml       # Steam Workshop WebView
│   │   ├── LibraryView.axaml       # Mods instalados + load order
│   │   ├── SettingsView.axaml      # Paths, SteamCMD config
│   │   └── ModDetailPanel.axaml    # Sidebar com info do mod em foco
│   ├── ViewModels/                 # MVVM (CommunityToolkit.Mvvm)
│   └── Assets/
│       └── overlay.js              # Script injetado na Workshop
│
└── StellarisModManager.csproj
```

---

## Funcionalidades — Fases

### Fase 1 — Core MVP

- [ ] **Setup inicial** — detetar pasta do Stellaris e pasta `mod/` automaticamente
- [ ] **Browser integrado** — Steam Workshop carregada dentro da app (`store.steampowered.com/workshop/browse/?appid=281990`)
- [ ] **Overlay de download** — ao navegar na Workshop, injeta um botão **"⬇ Install Mod"** por cima de cada mod em foco
- [ ] **Download via SteamCMD** — ao clicar no botão, chama SteamCMD em background para descarregar o mod
- [ ] **Auto-install** — após download, copia para `Documents/Paradox Interactive/Stellaris/mod/` e gera o `.mod` descriptor automaticamente
- [ ] **Biblioteca de mods** — lista todos os mods instalados com nome, versão, estado (ativo/inativo)
- [ ] **Ativar/desativar mods** — toggle simples

### Fase 2 — Gestão Avançada

- [ ] **Load order drag-and-drop** — reordenar mods na lista com arrastar
- [ ] **Perfis de mods** — guardar diferentes combinações (ex: "Multiplayer safe", "Solo full mods")
- [ ] **Deteção de versão** — verificar se o mod é compatível com a versão atual do jogo (parse do `descriptor.mod`)
- [ ] **Badge de multiplayer-safe** — identificar mods client-side automaticamente (apenas UI/gfx/music)
- [ ] **Verificar atualizações** — consultar Steam Workshop API para ver se há versão nova
- [ ] **Exportar/importar lista** — partilhar lista de mods com amigos (JSON)

### Fase 3 — Polimento

- [ ] **Página de detalhe do mod** — ao clicar num mod instalado, mostra thumbnail, descrição, versão, tipo
- [ ] **Filtros e pesquisa** — filtrar por ativo, tipo (UI/gráficos/música), compatível com versão X
- [ ] **SteamDB fallback** — alternativa ao SteamCMD para mods sem login
- [ ] **Notificações de update** — toast quando um mod instalado tem nova versão disponível
- [ ] **Dark mode** com tema cyberpunk opcional (já que és fã 😄)

---

## Overlay JS — Como Funciona

```javascript
// overlay.js — injetado no WebView quando a página da Workshop carrega
(function() {
    const observer = new MutationObserver(() => {
        document.querySelectorAll('.workshopItem').forEach(item => {
            if (item.querySelector('.smm-install-btn')) return; // já tem botão

            const btn = document.createElement('button');
            btn.className = 'smm-install-btn';
            btn.innerText = '⬇ Install';
            btn.style.cssText = `
                position: absolute; bottom: 8px; right: 8px;
                background: #4a9eff; color: white;
                border: none; border-radius: 4px;
                padding: 4px 10px; cursor: pointer;
                font-size: 12px; z-index: 999;
            `;
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Comunicar com C# via postMessage
                window.chrome.webview.postMessage({
                    action: 'install',
                    modId: item.dataset.publishedfileid || extractIdFromUrl(item)
                });
            };
            item.style.position = 'relative';
            item.appendChild(btn);
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
```

O C# recebe o `modId` via `WebView2.WebMessageReceived` e chama o `WorkshopDownloader`.

---

## Download — Estratégia

### Opção A: SteamCMD (recomendado)
```bash
# SteamCMD descarrega anonimamente mods públicos
steamcmd +login anonymous +workshop_download_item 281990 {MOD_ID} +quit
```
- Funciona sem conta Steam para mods públicos
- A app faz o wrap disto em background com progress bar

### Opção B: SteamDB / API HTTP (fallback)
- Consultar `https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`
- Download direto do CDN do Steam (funciona para alguns mods)
- Mais instável mas não requer SteamCMD

---

## UI/UX — Layout Principal

```
┌─────────────────────────────────────────────────────────┐
│  🛸 Stellaris Mod Manager          [_][□][X]            │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ [🌐 Browser] ◄─ ativo                                  │
│ [📦 Library]  │   Steam Workshop (WebView)              │
│ [⚙ Settings]  │   com botões "Install" injetados        │
│          │                                              │
│          │                                              │
│  ────    ├──────────────────────────────────────────────┤
│  v1.0.0  │  Status: A descarregar "UI Overhaul" 73%... │
└──────────┴──────────────────────────────────────────────┘
```

---

## Instruções para o Claude Code

```
Cria uma app Avalonia UI 11 em C# chamada StellarisModManager.

Começa pela Fase 1:
1. MainWindow com sidebar (Browser / Library / Settings)
2. BrowserView com WebView2 a carregar a Steam Workshop do Stellaris
3. Injeção do overlay.js quando a página carrega
4. Receção de postMessage com modId e chamada ao WorkshopDownloader
5. WorkshopDownloader que wrapa SteamCMD (incluir steamcmd.exe no bundle ou detetar instalação)
6. ModInstaller que copia ficheiros para a pasta mod do Stellaris e gera o .mod descriptor
7. LibraryView que lista SQLite com mods instalados, toggle ativo/inativo

Usa CommunityToolkit.Mvvm para MVVM.
Usa tema escuro (FluentTheme Dark).
Usa Avalonia.WebView para o browser embutido.
Target: Windows x64 (principal), Linux opcional.
```

---

## Dependências NuGet

```xml
<PackageReference Include="Avalonia" Version="11.*" />
<PackageReference Include="Avalonia.Desktop" Version="11.*" />
<PackageReference Include="Avalonia.WebView.Windows" Version="0.0.5" />
<PackageReference Include="CommunityToolkit.Mvvm" Version="8.*" />
<PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.*" />
<PackageReference Include="Serilog" Version="3.*" />
```

---

## Próximos Passos

1. **Agora** → Passar este plano ao Claude Code: `claude "implementa a Fase 1 do plano stellaris-mod-manager-plan.md"`
2. **Testar** com o Beautiful Universe que já tens descarregado em `C:\WorkshopDL\`
3. **Iterar** — adicionar load order e perfis na Fase 2
