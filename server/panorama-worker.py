from pathlib import Path
import os
from uuid import uuid4

import cv2
import numpy as np
from flask import Flask, jsonify, request

PANORAMAS = Path(os.environ.get("DATA_DIR", str(Path.home() / ".local/share/space-map-ttk"))) / "panoramas"
PANORAMAS.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=None)

# Максимальный размер всей отправляемой серии — 150 МБ.
app.config["MAX_CONTENT_LENGTH"] = 150 * 1024 * 1024

@app.errorhandler(413)
def too_large(error):
    return jsonify(error="Серия слишком большая. Максимум — 150 МБ."), 413


@app.post("/api/stitch")
def stitch():
    point_id = request.args.get("pointId")
    point_name = request.args.get("pointName")

    if not point_id or not point_name:
        return jsonify(error="Точка съёмки не выбрана."), 400

    files = request.files.getlist("photos")

    if not 2 <= len(files) <= 24:
        return jsonify(error="Добавьте от 2 до 24 фотографий."), 400

    images = []

    try:
        for number, file in enumerate(files, start=1):
            raw = file.read()

            if not raw:
                return jsonify(error=f"Кадр {number} пустой."), 400

            image = cv2.imdecode(
                np.frombuffer(raw, dtype=np.uint8),
                cv2.IMREAD_COLOR,
            )

            if image is None:
                return jsonify(
                    error=f"Не удалось прочитать кадр {number}. Используйте JPEG."
                ), 400

            # Уменьшаем снимки для первого теста, чтобы ускорить обработку.
            height, width = image.shape[:2]
            scale = min(1.0, 1600 / max(height, width))

            if scale < 1:
                image = cv2.resize(
                    image,
                    (round(width * scale), round(height * scale)),
                    interpolation=cv2.INTER_AREA,
                )

            images.append(image)

        stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
        status, panorama = stitcher.stitch(images)

        if status != cv2.Stitcher_OK:
            messages = {
                1: (
                    "Не найдено достаточно совпадений между кадрами. "
                    "Попробуйте 3–5 соседних снимков с большим перекрытием."
                ),
                2: (
                    "Не удалось сопоставить геометрию кадров. "
                    "Проверьте, что снимки сделаны с одной точки."
                ),
                3: (
                    "Не удалось согласовать положение камеры. "
                    "Попробуйте меньшую серию соседних кадров."
                ),
            }

            return jsonify(
                error=messages.get(
                    int(status), "OpenCV не смог собрать эту серию."
                ),
                code=int(status),
            ), 422

        # Уникальное имя: новая попытка не перезаписывает прошлую.
        filename = f"{uuid4().hex}.jpg"

        ok, encoded = cv2.imencode(
            ".jpg", panorama, [cv2.IMWRITE_JPEG_QUALITY, 92]
        )

        if not ok:
            return jsonify(error="Не удалось создать итоговый JPEG."), 500

        # Такой способ записи работает и с кириллицей в пути Windows.
        (PANORAMAS / filename).write_bytes(encoded.tobytes())

        result = {
            "filename": filename,
            "pointId": point_id,
            "pointName": point_name,
            "width": int(panorama.shape[1]),
            "height": int(panorama.shape[0]),
            "inputCount": len(images),
        }

        return jsonify(result)

    except cv2.error:
        app.logger.exception("Ошибка OpenCV")
        return jsonify(
            error="Ошибка обработки изображений. Попробуйте другую серию."
        ), 422

    except OSError:
        app.logger.exception("Ошибка записи")
        return jsonify(
            error="Не удалось сохранить результат. Проверьте свободное место."
        ), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("STITCH_PORT", "5000")), debug=False)