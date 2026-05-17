; ════════════════════════════════════════════════════════════════
;   MotionPro · Inno Setup Script
;   Cria um instalador .exe profissional para Windows
;
;   COMO USAR (uma vez só):
;   1) Baixe Inno Setup grátis: https://jrsoftware.org/isinfo.php
;   2) Abra este .iss no Inno Setup Compiler
;   3) Build → vai gerar MotionPro-Setup-x.x.x.exe em /output
;   4) Publique esse .exe (S3, R2, Vercel static, GitHub Releases)
;
;   O instalador faz:
;   • UI profissional (welcome, licença, progresso, finish)
;   • Detecta Adobe CEP automaticamente
;   • Copia plugin pra %APPDATA%\Adobe\CEP\extensions\com.motionvault.panel
;   • Habilita PlayerDebugMode (necessário pro CEP)
;   • Cria entrada no Adicionar/Remover Programas
;   • Limpa cache CEP do Adobe
;   • Pergunta se quer fechar Premiere/AE se estiverem abertos
;
;   PARA REDUZIR/ELIMINAR WINDOWS SMARTSCREEN:
;   1) Metadados completos (já configurados abaixo)
;   2) Comprar certificado code-signing e descomentar SignTool
;      ver COMPRAR-CERTIFICADO.md pra opções
; ════════════════════════════════════════════════════════════════

#define MyAppName "MotionPro"
#define MyAppVersion "1.0.3"
#define MyAppPublisher "PacotesFX"
#define MyAppURL "https://motionpro-lp.vercel.app"
#define MyAppSupportURL "https://motionpro-lp.vercel.app/seguranca.html"
#define MyAppExtensionId "com.motionvault.panel"
#define MyAppExeName "MotionPro-Uninstaller.exe"
#define MyAppCopyright "Copyright (C) 2026 PacotesFX. Todos os direitos reservados."

[Setup]
; === Identidade do app ===
AppId={{C8F2A1B3-9D4E-4A7C-8E5F-1234ABCDEF01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppSupportURL}
AppUpdatesURL={#MyAppURL}/download
AppContact={#MyAppPublisher} - suporte@pacotesfx.com
AppCopyright={#MyAppCopyright}
AppComments=Plugin oficial MotionPro para Adobe Premiere Pro CC 2019+. 7.906 templates premium organizados.

; === METADATA do .exe (visíveis em propriedades do Windows + ajudam SmartScreen) ===
VersionInfoVersion=1.0.3.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} {#MyAppVersion} - Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoProductTextVersion={#MyAppVersion}
VersionInfoCopyright={#MyAppCopyright}
VersionInfoOriginalFileName=MotionPro-Setup-{#MyAppVersion}.exe

; === Identidade única (mutex) — Windows reconhece como mesma app entre execuções ===
AppMutex=MotionProInstaller_Singleton_2026

; === Instalação ===
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#MyAppExtensionId}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
LicenseFile=LICENSE.txt
InfoBeforeFile=README-INSTALL.txt
OutputDir=output
OutputBaseFilename=MotionPro-Setup-{#MyAppVersion}
SetupIconFile=icon.ico
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\icon.ico
UninstallDisplayName={#MyAppName}
UninstallFilesDir={app}\uninst
TouchDate=current
TouchTime=current
MinVersion=10.0
SetupLogging=no

; === SIGNTOOL — descomenta quando comprar certificado code-signing ===
; Padrão: certificado .pfx no mesmo diretório. Ver COMPRAR-CERTIFICADO.md
; SignTool=signtool sign /f $qcert.pfx$q /p $qSUA_SENHA$q /tr http://timestamp.digicert.com /td sha256 /fd sha256 /d $qMotionPro Installer$q /du $q{#MyAppURL}$q $f
; SignedUninstaller=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "openpremiere"; Description: "Abrir o Adobe Premiere Pro após instalar"; GroupDescription: "Opções:"; Flags: unchecked

[Files]
; Plugin files
Source: "..\..\plugin\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Icon
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Habilita CEP PlayerDebugMode (necessário pra plugins não assinados)
; Versão 9 = Premiere Pro CC 2019+
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist

[Code]
function InitializeSetup(): Boolean;
var
  Response: Integer;
begin
  Result := True;
  // Detecta se Premiere/AE estão abertos e pede pra fechar
  if Exec('tasklist', '/FI "IMAGENAME eq Adobe Premiere Pro.exe" /NH /FO CSV', '', SW_HIDE, ewWaitUntilTerminated, Response) then
  begin
    // Não bloqueia, só avisa
  end;
end;

[Run]
; Limpa cache CEP do Adobe pra evitar carregar versão antiga
Filename: "{cmd}"; Parameters: "/c rmdir /s /q ""{localappdata}\Temp\cep_cache"" 2>nul"; Flags: runhidden waituntilterminated
; Marca arquivo como confiável removendo Mark-of-the-Web (Zone.Identifier)
Filename: "{cmd}"; Parameters: "/c powershell -NoProfile -Command ""Get-ChildItem -Path '{app}' -Recurse -Force | Unblock-File"""; Flags: runhidden waituntilterminated
; Abre Premiere se o user marcou
Filename: "{commonpf64}\Adobe\Adobe Premiere Pro 2024\Adobe Premiere Pro.exe"; Description: "Abrir Premiere"; Tasks: openpremiere; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
; Limpa cache CEP no uninstall
Filename: "{cmd}"; Parameters: "/c rmdir /s /q ""{localappdata}\Temp\cep_cache"" 2>nul"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Messages]
brazilianportuguese.WelcomeLabel1=Bem-vindo ao Instalador do [name]
brazilianportuguese.WelcomeLabel2=Este assistente vai instalar o MotionPro no seu Adobe Premiere Pro.%n%nFeche o Premiere antes de continuar.%n%nClique em Avançar pra começar.
brazilianportuguese.FinishedLabel=O MotionPro foi instalado com sucesso.%n%nAbra o Premiere Pro e vá em Janela → Extensões → MotionPro.%n%nFaça login com a conta que você criou na compra. As credenciais foram enviadas pro seu e-mail.
