; Motion Pro Titles · Inno Setup script v2.0.0
; Gera installer .exe profissional sem aviso SmartScreen agressivo
; Compila com: ISCC.exe motion-titles.iss

#define MyAppName "Motion Pro Titles"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "PacotesFX"
#define MyAppURL "https://motionpro-lp.vercel.app"
#define MyAppDescription "Plugin Adobe Premiere Pro · 7906 templates de títulos animados"
#define MyExtId "com.motionvault.panel"
#define MyPluginSrcDir "..\..\plugin"

[Setup]
AppId={{8F4C9D2A-1234-4567-8901-MTITLES000001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppCopyright=Copyright (C) 2026 PacotesFX

; Install na pasta CEP do user (não precisa admin)
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#MyExtId}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible

; Output
OutputDir=output
OutputBaseFilename=MotionPro-Titles-{#MyAppVersion}-Setup
SetupIconFile=
Compression=lzma2/ultra
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

; UI
WizardStyle=modern
WizardSizePercent=120
ShowLanguageDialog=no
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no
DisableDirPage=yes

; Uninstaller aparece em Programas e Recursos
UninstallDisplayName={#MyAppName} {#MyAppVersion}
UninstallDisplayIcon={app}\img\icon.png
UninstallFilesDir={app}\_uninstall

[Languages]
Name: "brazilian"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; Tudo da pasta plugin/ vai pro destino
Source: "{#MyPluginSrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Sem atalho no menu iniciar (plugin abre dentro do Premiere)
; Apenas link pra abrir o Premiere no Programas e Recursos via desinstalador

[Registry]
; Habilita CEP PlayerDebugMode em todas versoes Premiere (CEP 9 a 12)
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Run]
; Pos-instalacao: nao auto-abre Premiere (deixa user decidir)
Filename: "{app}\index.html"; Description: "Abrir documentacao do plugin"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
; Pre-desinstalacao: fecha Premiere se aberto
Filename: "{cmd}"; Parameters: "/c taskkill /F /IM ""Adobe Premiere Pro.exe"" >nul 2>&1"; Flags: runhidden; RunOnceId: "CloseAEPP"

[Code]
function InitializeSetup(): Boolean;
var
  PremiereRunning: Integer;
  ResultCode: Integer;
begin
  Result := True;
  // Detecta se Premiere ta rodando — pede pra fechar
  Exec('cmd.exe', '/c tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" | find /I "Adobe Premiere Pro.exe" >nul', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode = 0 then begin
    if MsgBox('O Adobe Premiere Pro esta aberto. Pra instalar o plugin, ele precisa ser fechado.' + #13#10 + #13#10 + 'Quer fechar o Premiere agora e continuar?', mbConfirmation, MB_YESNO) = IDYES then begin
      Exec('cmd.exe', '/c taskkill /F /IM "Adobe Premiere Pro.exe"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(2000);
    end else begin
      MsgBox('Feche o Premiere e rode o instalador de novo.', mbInformation, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  CacheDir: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    // Limpa cache CEP pra forcar Premiere recarregar
    CacheDir := ExpandConstant('{localappdata}\Temp\cep_cache');
    if DirExists(CacheDir) then begin
      Exec('cmd.exe', '/c rmdir /s /q "' + CacheDir + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CacheDir: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then begin
    CacheDir := ExpandConstant('{localappdata}\Temp\cep_cache');
    if DirExists(CacheDir) then begin
      Exec('cmd.exe', '/c rmdir /s /q "' + CacheDir + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;
