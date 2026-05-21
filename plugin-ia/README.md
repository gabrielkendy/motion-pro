# Motion IA · v3.0

Plugin CEP do Premiere Pro com 12 features de IA + automação.

## Setup dev

```powershell
cd "C:\Users\Gabriel\Documents\Motion Bro\MotionVault"
.\tools\download-bin-motion-ia.ps1
robocopy plugin-ia "$env:APPDATA\Adobe\CEP\extensions\com.motionpro.ia" /MIR /XD node_modules .git
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\cep_cache" -ErrorAction SilentlyContinue
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

## License key teste
`MIA-PRO-8498-F653-BDC5-A665` — pro tier, 3 devices.

Ver CHANGELOG.md pra detalhes das 12 features e tech stack.
