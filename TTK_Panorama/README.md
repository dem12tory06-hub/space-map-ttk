# TTK Panorama

Отдельный локальный прототип склейки панорам. Код пока не подключён к основному Node-серверу и Aeza.

Проверено с Python 3.12. На Windows из этой папки:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

Откройте http://127.0.0.1:5000. Загрузите 2–24 снимка одной точки; сервер собирает JPEG через OpenCV. Результаты появляются в папке `panoramas/`, которая исключена из Git. Суммарный размер отправляемой серии ограничен 150 МБ.
