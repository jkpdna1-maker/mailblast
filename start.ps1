Start-Process powershell -ArgumentList @("-NoExit", "-Command", "cd C:\Users\JKRAOWIN\mailblast\backend; node server.js")
Start-Process powershell -ArgumentList @("-NoExit", "-Command", "`$env:PORT=3000; cd C:\Users\JKRAOWIN\mailblast\frontend; npm start")
Start-Process "https://mailblast-fyz1.onrender.com"