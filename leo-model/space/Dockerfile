FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir tokenizers numpy
# Leo code is taken from GitHub; the trained weights are uploaded next to this file.
RUN git clone --depth 1 https://github.com/harringtonov-cloud/leo.ai /code
WORKDIR /code/leo-model
COPY ckpt.pt tokenizer.json /model/
# LEO_API_KEY is provided by the Space secret of the same name.
CMD ["python", "serve.py", "--ckpt", "/model/ckpt.pt", "--tokenizer", "/model/tokenizer.json", "--host", "0.0.0.0", "--port", "7860"]
