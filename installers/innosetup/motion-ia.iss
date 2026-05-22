; Motion Pro IA · Inno Setup script v4.0.3
; Gera installer .exe profissional sem aviso SmartScreen agressivo

#define MyAppName "Motion Pro IA"
#define MyAppVersion "4.0.3"
#define MyAppPublisher "PacotesFX"
#define MyAppURL "https://motionpro-lp.vercel.app"
#define MyAppDescription "Agente de Edicao IA pra Premiere Pro · Gemini Flash 2.0 + Seedance"
#define MyExtId "com.motionpro.ia"
#define MyPluginSrcDir "..\..\plugin-ia"

[Setup]
AppId={{8F4C9D2A-1234-4567-8901-MIA000000001}
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
OutputBaseFilename=MotionPro-IA-{#MyAppVersion}-Setup
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
; Plugin completo · EXCETO models/*.bin (Whisper baixa em runtime, evita installer 250MB)
Source: "{#MyPluginSrcDir}\*"; DestDir: "{app}"; Excludes: "models\*.bin,models\*.bin.part,.git\*,node_modules\*"; Flags: ignoreversion recursesubdirs createallsubdirs

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
