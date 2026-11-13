import sys, argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

parser = argparse.ArgumentParser()
parser.add_argument("port", nargs="?", default="3015")
args, _unknown = parser.parse_known_args()
port = 3015
for a in sys.argv[1:]:
    if a.isdigit():
        port = int(a)
    elif a == "--port" or a.isdigit() is False and a.startswith("-") is False and a.isdigit():
        pass
ThreadingHTTPServer(("0.0.0.0", port), SimpleHTTPRequestHandler).serve_forever()
