; Motion Pro IA · Inno Setup script v4.0.0 (Sprint MEGA · Onda 5 · close v2.1)
; Gera installer .exe profissional protegido (LZMA2 ultra + JS obfuscado)
; Compila com: ISCC.exe motion-ia.iss
;   ou via:    tools\build-ia-installer.ps1 (faz stage + obfuscation antes)

#define MyAppName "Motion Pro IA"
#define MyAppVersion "4.0.0"
#define MyAppPublisher "PacotesFX"
#define MyAppPublisherURL "https://motionpro-lp.vercel.app"
#define MyAppCopyright "Copyright (C) 2026 PacotesFX"
#define MyAppDescription "Agente de Edicao IA pra Premiere Pro · Gemini Flash 2.0 + Seedance"
#define MyExtensionBundleId "com.motionpro.ia"
#define MyAppId "{{8F4C9D2A-1234-4567-8901-MIA0000000001}"

; Source default: pasta staging protegida (gerada por tools\build-ia-installer.ps1)
; Pra build direto sem obfuscation passe /DMyPluginSrcDir="..\..\plugin-ia"
#ifndef MyPluginSrcDir
#define MyPluginSrcDir "..\..\_build_ia_protected"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppPublisherURL}
AppSupportURL={#MyAppPublisherURL}
AppUpdatesURL={#MyAppPublisherURL}
AppCopyright={#MyAppCopyright}

DefaultDirName={userappdata}\Adobe\CEP\extensions\{#MyExtensionBundleId}
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

; Auto-fecha aplicacoes que travam arquivos do plugin (Premiere)
CloseApplications=force
RestartApplications=no

UninstallDisplayName={#MyAppName} {#MyAppVersion}
UninstallFilesDir={app}\_uninstall

[Languages]
Name: "brazilian"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "runPremiere"; Description: "Abrir o Adobe Premiere Pro apos a instalacao"; Flags: unchecked

[Files]
; Plugin completo (staging protegido).
; Excludes: models/*.bin (Whisper baixa runtime ~145MB), caches, backups, scripts dev.
Source: "{#MyPluginSrcDir}\*"; DestDir: "{app}"; \
    Excludes: "node_modules\*,.git\*,*.log,models\*.bin,models\*.bin.part,*.bak,*.iss,test-results\*,playwright-report\*,tests\*,docs\*,_uninstall\*"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
; Habilita CEP PlayerDebugMode em todas versoes Premiere (CSXS 9 a 12)
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Run]
; Pos-instalacao opcional: abre Premiere se task selecionado e exe localizado
Filename: "{code:GetPremiereExe}"; Description: "Abrir Adobe Premiere Pro"; \
    Tasks: runPremiere; Check: PremiereExeFound; \
    Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
; Pre-desinstalacao: fecha Premiere se aberto (libera arquivos)
Filename: "{cmd}"; Parameters: "/c taskkill /F /IM ""Adobe Premiere Pro.exe"" >nul 2>&1"; Flags: runhidden; RunOnceId: "ClosePPro"

[UninstallDelete]
; Remove pasta da extension recursivamente
Type: filesandordirs; Name: "{app}"
; PRESERVA cache do Whisper em %LOCALAPPDATA%\Motion IA\ (~145MB de modelos baixados)
; → NAO listado aqui de proposito.

[Code]
var
  PremiereExePath: String;

function FindPremiereExe(): String;
var
  Candidates: TArrayOfString;
  Years: TArrayOfString;
  i, j: Integer;
  Path: String;
begin
  Result := '';
  SetArrayLength(Years, 6);
  Years[0] := '2026'; Years[1] := '2025'; Years[2] := '2024';
  Years[3] := '2023'; Years[4] := '2022'; Years[5] := '';

  SetArrayLength(Candidates, 2);
  Candidates[0] := ExpandConstant('{commonpf64}\Adobe');
  Candidates[1] := ExpandConstant('{commonpf}\Adobe');

  for i := 0 to GetArrayLength(Candidates) - 1 do begin
    for j := 0 to GetArrayLength(Years) - 1 do begin
      if Years[j] = '' then
        Path := Candidates[i] + '\Adobe Premiere Pro\Adobe Premiere Pro.exe'
      else
        Path := Candidates[i] + '\Adobe Premiere Pro ' + Years[j] + '\Adobe Premiere Pro.exe';
      if FileExists(Path) then begin
        Result := Path;
        Exit;
      end;
    end;
  end;
end;

function PremiereExeFound(): Boolean;
begin
  if PremiereExePath = '' then
    PremiereExePath := FindPremiereExe();
  Result := PremiereExePath <> '';
end;

function GetPremiereExe(Param: String): String;
begin
  if PremiereExePath = '' then
    PremiereExePath := FindPremiereExe();
  Result := PremiereExePath;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  // Detecta + fecha Premiere se rodando (evita arquivo em uso)
  Exec('cmd.exe', '/c tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" | find /I "Adobe Premiere Pro.exe" >nul', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode = 0 then begin
    if MsgBox('O Adobe Premiere Pro esta aberto. Pra instalar o plugin, ele precisa ser fechado.' + #13#10 + #13#10 + 'Quer fechar o Premiere agora e continuar?', mbConfirmation, MB_YESNO) = IDYES then begin
      Exec('cmd.exe', '/c taskkill /F /IM "Adobe Premiere Pro.exe" /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(2000);
    end else begin
      MsgBox('Feche o Premiere e rode o instalador de novo.', mbInformation, MB_OK);
      Result := False;
      Exit;
    end;
  end;

  // Limpa cep_cache antes do install (forca Premiere recarregar manifest)
  Exec('cmd.exe', '/c if exist "%LOCALAPPDATA%\Temp\cep_cache" rmdir /s /q "%LOCALAPPDATA%\Temp\cep_cache"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  CacheDir: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    // Limpa cache CEP de novo (pos-install) — garante reload limpo
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
