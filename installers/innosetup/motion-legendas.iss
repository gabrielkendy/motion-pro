; Motion Pro Legendas · Inno Setup script v2.0.0
; Gera installer .exe profissional sem aviso SmartScreen agressivo

#define MyAppName "Motion Pro Legendas"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "PacotesFX"
#define MyAppURL "https://motionpro-lp.vercel.app"
#define MyAppDescription "Plugin Adobe Premiere Pro · 549 templates de legendas word-level + Estilo Global"
#define MyExtId "com.motionpro.legendas"
#define MyPluginSrcDir "..\..\plugin-legendas"

[Setup]
AppId={{8F4C9D2A-1234-4567-8901-MLEGENDA00001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppCopyright=Copyright (C) 2026 PacotesFX

DefaultDirName={userappdata}\Adobe\CEP\extensions\{#MyExtId}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible

OutputDir=output
OutputBaseFilename=MotionPro-Legendas-{#MyAppVersion}-Setup
Compression=lzma2/ultra
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

WizardStyle=modern
WizardSizePercent=120
ShowLanguageDialog=no
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no
DisableDirPage=yes

UninstallDisplayName={#MyAppName} {#MyAppVersion}
UninstallFilesDir={app}\_uninstall

[Languages]
Name: "brazilian"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; Plugin completo · packs/ep-texto + sfx + JSONs metadata
; ATENCAO: NAO copia packs/_backup_pre_font_fix e packs/_backup_pre_all_helvetica_bold
; (snapshots de edicao internos)
Source: "{#MyPluginSrcDir}\CSXS\*";       DestDir: "{app}\CSXS";       Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\css\*";        DestDir: "{app}\css";        Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\fonts\*";      DestDir: "{app}\fonts";      Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\img\*";        DestDir: "{app}\img";        Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#MyPluginSrcDir}\js\*";         DestDir: "{app}\js";         Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\jsx\*";        DestDir: "{app}\jsx";        Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\index.html";   DestDir: "{app}";            Flags: ignoreversion
Source: "{#MyPluginSrcDir}\CHANGELOG.md"; DestDir: "{app}";            Flags: ignoreversion skipifsourcedoesntexist
Source: "{#MyPluginSrcDir}\README.md";    DestDir: "{app}";            Flags: ignoreversion skipifsourcedoesntexist
; packs/ — só ep-texto + sfx + catalog.json (não os _backup_*)
Source: "{#MyPluginSrcDir}\packs\ep-texto\*";              DestDir: "{app}\packs\ep-texto"; Excludes: "_backup_pre_font_fix\*,_backup_pre_all_helvetica_bold\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#MyPluginSrcDir}\packs\sfx\*";                   DestDir: "{app}\packs\sfx";      Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#MyPluginSrcDir}\packs\catalog.json";            DestDir: "{app}\packs";          Flags: ignoreversion
Source: "{#MyPluginSrcDir}\packs\font-requirements.json";  DestDir: "{app}\packs";          Flags: ignoreversion skipifsourcedoesntexist
Source: "{#MyPluginSrcDir}\packs\slot-info.json";          DestDir: "{app}\packs";          Flags: ignoreversion skipifsourcedoesntexist

[Registry]
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /F /IM ""Adobe Premiere Pro.exe"" >nul 2>&1"; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
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
