import unittest
from unittest.mock import Mock, patch

import requests

from backend.llm.llm_gateway import OllamaGateway, OllamaUnavailableError, reset_endpoint_capabilities


def _http_error(url: str, status_code: int) -> requests.HTTPError:
    response = requests.Response()
    response.status_code = status_code
    response.url = url
    error = requests.HTTPError(f"{status_code} Client Error: Not Found for url: {url}")
    error.response = response
    return error


class OllamaGatewayTests(unittest.TestCase):
    def setUp(self):
        reset_endpoint_capabilities()

    @patch("backend.llm.llm_gateway.estimate_tokens", return_value=12)
    @patch("backend.llm.llm_gateway.requests.post")
    @patch.object(OllamaGateway, "list_models", return_value=["auraqc-hypothesis:latest"])
    def test_gateway_reuses_last_successful_endpoint(self, _mock_models, mock_post, _mock_tokens):
        chat_response = Mock()
        chat_response.json.return_value = {"message": {"content": "hello"}, "model": "auraqc-hypothesis:latest"}
        chat_response.raise_for_status.return_value = None

        mock_post.return_value = chat_response
        gateway = OllamaGateway("http://localhost:11434", "auraqc-hypothesis", 10)

        first = gateway.generate("hello")
        second = gateway.generate("hello again")

        self.assertEqual(first["endpoint_used"], "/api/chat")
        self.assertEqual(second["endpoint_used"], "/api/chat")
        called_paths = [call.args[0] for call in mock_post.call_args_list]
        self.assertEqual(called_paths, [
            "http://localhost:11434/api/chat",
            "http://localhost:11434/api/chat",
        ])

    @patch("backend.llm.llm_gateway.requests.get")
    @patch("backend.llm.llm_gateway.requests.post")
    @patch.object(OllamaGateway, "list_models", return_value=["auraqc-hypothesis:latest"])
    def test_gateway_caches_404_endpoints_and_reports_api_mismatch(self, _mock_models, mock_post, mock_get):
        tags_response = Mock()
        tags_response.raise_for_status.return_value = None
        tags_response.json.return_value = {"models": [{"name": "auraqc-hypothesis:latest"}]}
        mock_get.return_value = tags_response

        mock_post.side_effect = [
            _http_error("http://localhost:11434/api/chat", 404),
            _http_error("http://localhost:11434/api/generate", 404),
            _http_error("http://localhost:11434/v1/completions", 404),
        ]

        gateway = OllamaGateway("http://localhost:11434", "auraqc-hypothesis", 10)

        with self.assertRaises(OllamaUnavailableError) as first_error:
            gateway.generate("hello")

        self.assertIn("404", str(first_error.exception))
        self.assertEqual(mock_post.call_count, 3)

        mock_post.reset_mock()

        with self.assertRaises(OllamaUnavailableError) as second_error:
            gateway.generate("hello again")

        self.assertEqual(mock_post.call_count, 0)
        self.assertIn("API mismatch", str(second_error.exception))


if __name__ == "__main__":
    unittest.main()
