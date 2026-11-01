; Calivix — ajustes do instalador do Windows (incluído pelo electron-builder).
; Os atalhos usam o ícone em alta resolução e com transparência (resources\icone.ico), e o Windows
; é avisado para renovar o cache de ícones — senão ele continua mostrando o ícone antigo (ou branco).

; Antes de instalar, encerra o app se estiver aberto. Se a versão antiga continuar rodando, a pessoa segue vendo ela.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /T /IM "${PRODUCT_FILENAME}.exe"'
  Pop $0
  Sleep 800
!macroend

!macro customInstall
  ${If} ${FileExists} "$INSTDIR\resources\icone.ico"
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\resources\icone.ico" 0
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\resources\icone.ico" 0
  ${EndIf}
  ; Renova o cache de ícones (Windows 10/11 e versões anteriores) e avisa o Explorer.
  nsExec::Exec 'ie4uinit.exe -show'
  Pop $0
  nsExec::Exec 'ie4uinit.exe -ClearIconCache'
  Pop $0
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
