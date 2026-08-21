using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ComputerUseValidator
{
    internal sealed class ComputerResponse
    {
        public string Id { get; set; }
        public ComputerCall Call { get; set; }
        public string OutputText { get; set; }
        public string RawJson { get; set; }
    }

    internal sealed class ComputerCall
    {
        public string CallId { get; set; }
        public List<IDictionary<string, object>> Actions { get; set; }
    }

    internal sealed class OpenAIComputerClient
    {
        private readonly string _apiKey;
        private readonly string _model;
        private readonly JavaScriptSerializer _json;
        private readonly Action<string> _log;

        public OpenAIComputerClient(string apiKey, string model)
            : this(apiKey, model, null)
        {
        }

        public OpenAIComputerClient(string apiKey, string model, Action<string> log)
        {
            _apiKey = apiKey;
            _model = model;
            _log = log;
            _json = new JavaScriptSerializer();
            _json.MaxJsonLength = int.MaxValue;
            _json.RecursionLimit = 200;
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            ServicePointManager.Expect100Continue = false;
            ServicePointManager.DefaultConnectionLimit = 10;
        }

        public ComputerResponse Start(string prompt)
        {
            return Parse(Post(BuildStartRequest(prompt)));
        }

        public ComputerResponse Continue(string previousResponseId, string callId, byte[] screenshot)
        {
            return Parse(Post(BuildContinueRequest(previousResponseId, callId, screenshot)));
        }

        private Dictionary<string, object> BuildStartRequest(string prompt)
        {
            Dictionary<string, object> request = new Dictionary<string, object>();
            request["model"] = _model;
            request["tools"] = new object[] { new Dictionary<string, object> { { "type", "computer" } } };
            request["input"] = prompt;
            return request;
        }

        private Dictionary<string, object> BuildContinueRequest(string previousResponseId, string callId, byte[] screenshot)
        {
            Dictionary<string, object> screenshotOutput = new Dictionary<string, object>();
            screenshotOutput["type"] = "computer_screenshot";
            screenshotOutput["image_url"] = DataUri(screenshot, "image/png");
            screenshotOutput["detail"] = "original";

            Dictionary<string, object> callOutput = new Dictionary<string, object>();
            callOutput["type"] = "computer_call_output";
            callOutput["call_id"] = callId;
            callOutput["output"] = screenshotOutput;

            Dictionary<string, object> request = new Dictionary<string, object>();
            request["model"] = _model;
            request["tools"] = new object[] { new Dictionary<string, object> { { "type", "computer" } } };
            request["previous_response_id"] = previousResponseId;
            request["input"] = new object[] { callOutput };

            return request;
        }

        private string Post(Dictionary<string, object> payload)
        {
            byte[] requestBytes = Encoding.UTF8.GetBytes(_json.Serialize(payload));
            WebException lastConnectionError = null;

            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    return SendOnce(requestBytes);
                }
                catch (WebException error)
                {
                    if (!IsRetryable(error) || attempt >= 3)
                    {
                        throw CreateApiException(error);
                    }

                    lastConnectionError = error;
                    int delaySeconds = attempt == 1 ? 1 : 2;
                    if (_log != null)
                    {
                        _log(string.Format(
                            "OpenAI 网络连接中断（{0}），{1} 秒后自动重试 {2}/2…",
                            DescribeWebException(error), delaySeconds, attempt));
                    }
                    Thread.Sleep(delaySeconds * 1000);
                }
            }

            throw CreateApiException(lastConnectionError);
        }

        private HttpWebRequest CreateRequest(byte[] requestBytes)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("https://api.openai.com/v1/responses");
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Accept = "application/json";
            request.Headers[HttpRequestHeader.Authorization] = "Bearer " + _apiKey;
            request.UserAgent = "ComputerUseValidator/0.1";
            request.KeepAlive = false;
            request.ProtocolVersion = HttpVersion.Version11;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            request.Timeout = 600000;
            request.ReadWriteTimeout = 600000;
            request.ContentLength = requestBytes.Length;
            return request;
        }

        private string SendOnce(byte[] requestBytes)
        {
            HttpWebRequest request = CreateRequest(requestBytes);

            using (Stream requestStream = request.GetRequestStream())
            {
                requestStream.Write(requestBytes, 0, requestBytes.Length);
            }

            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static bool IsRetryable(WebException error)
        {
            if (error == null) return false;

            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response != null)
            {
                int status = (int)response.StatusCode;
                return status == 408 || status == 409 || status == 429 || status >= 500;
            }

            switch (error.Status)
            {
                case WebExceptionStatus.ConnectFailure:
                case WebExceptionStatus.ConnectionClosed:
                case WebExceptionStatus.KeepAliveFailure:
                case WebExceptionStatus.NameResolutionFailure:
                case WebExceptionStatus.PipelineFailure:
                case WebExceptionStatus.ProxyNameResolutionFailure:
                case WebExceptionStatus.ReceiveFailure:
                case WebExceptionStatus.SecureChannelFailure:
                case WebExceptionStatus.SendFailure:
                case WebExceptionStatus.Timeout:
                    return true;
                default:
                    return false;
            }
        }

        private static InvalidOperationException CreateApiException(WebException error)
        {
            if (error == null)
            {
                return new InvalidOperationException("OpenAI API 请求失败：未知网络错误。");
            }

            string detail = error.Message;
            if (error.Response != null)
            {
                try
                {
                    using (StreamReader reader = new StreamReader(error.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        string body = reader.ReadToEnd();
                        if (!string.IsNullOrWhiteSpace(body)) detail = body;
                    }
                }
                catch { }
            }
            return new InvalidOperationException("OpenAI API 请求失败：" + detail, error);
        }

        private static string DescribeWebException(WebException error)
        {
            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response != null) return "HTTP " + (int)response.StatusCode;
            return error.Status.ToString();
        }

        private ComputerResponse Parse(string rawJson)
        {
            IDictionary<string, object> root = _json.DeserializeObject(rawJson) as IDictionary<string, object>;
            if (root == null)
            {
                throw new InvalidOperationException("OpenAI API 返回了无法识别的内容。");
            }

            if (root.ContainsKey("error") && root["error"] != null)
            {
                IDictionary<string, object> error = root["error"] as IDictionary<string, object>;
                throw new InvalidOperationException("OpenAI API 返回错误：" + JsonValue.String(error, "message"));
            }

            ComputerResponse parsed = new ComputerResponse();
            parsed.Id = JsonValue.String(root, "id");
            parsed.RawJson = rawJson;
            parsed.OutputText = string.Empty;

            foreach (object rawItem in JsonValue.List(root, "output"))
            {
                IDictionary<string, object> item = rawItem as IDictionary<string, object>;
                if (item == null) continue;
                string type = JsonValue.String(item, "type");

                if ((type == "computer_call" || type == "computer_use_call") && parsed.Call == null)
                {
                    ComputerCall call = new ComputerCall();
                    call.CallId = JsonValue.String(item, "call_id");
                    if (string.IsNullOrEmpty(call.CallId)) call.CallId = JsonValue.String(item, "id");
                    call.Actions = new List<IDictionary<string, object>>();
                    foreach (object rawAction in JsonValue.List(item, "actions"))
                    {
                        IDictionary<string, object> action = rawAction as IDictionary<string, object>;
                        if (action != null) call.Actions.Add(action);
                    }
                    if (call.Actions.Count == 0 && item.ContainsKey("action"))
                    {
                        IDictionary<string, object> legacyAction = item["action"] as IDictionary<string, object>;
                        if (legacyAction != null) call.Actions.Add(legacyAction);
                    }
                    parsed.Call = call;
                }
                else if (type == "message")
                {
                    foreach (object rawContent in JsonValue.List(item, "content"))
                    {
                        IDictionary<string, object> content = rawContent as IDictionary<string, object>;
                        if (content == null) continue;
                        string contentType = JsonValue.String(content, "type");
                        if (contentType == "output_text")
                        {
                            if (parsed.OutputText.Length > 0) parsed.OutputText += Environment.NewLine;
                            parsed.OutputText += JsonValue.String(content, "text");
                        }
                    }
                }
            }

            if (string.IsNullOrEmpty(parsed.Id))
            {
                throw new InvalidOperationException("OpenAI API 响应中没有 response id。");
            }
            return parsed;
        }

        private static string DataUri(byte[] bytes, string mime)
        {
            return "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
        }

    }

    internal static class JsonValue
    {
        internal static string String(IDictionary<string, object> dictionary, string key)
        {
            if (dictionary == null || !dictionary.ContainsKey(key) || dictionary[key] == null) return string.Empty;
            return Convert.ToString(dictionary[key], CultureInfo.InvariantCulture) ?? string.Empty;
        }

        internal static int Int(IDictionary<string, object> dictionary, string key)
        {
            if (dictionary == null || !dictionary.ContainsKey(key) || dictionary[key] == null) return 0;
            return Convert.ToInt32(dictionary[key], CultureInfo.InvariantCulture);
        }

        internal static List<object> List(IDictionary<string, object> dictionary, string key)
        {
            List<object> values = new List<object>();
            if (dictionary == null || !dictionary.ContainsKey(key) || dictionary[key] == null) return values;
            IEnumerable enumerable = dictionary[key] as IEnumerable;
            if (enumerable == null || dictionary[key] is string) return values;
            foreach (object item in enumerable) values.Add(item);
            return values;
        }

        internal static List<string> StringList(IDictionary<string, object> dictionary, string key)
        {
            List<string> values = new List<string>();
            foreach (object item in List(dictionary, key))
            {
                if (item != null) values.Add(Convert.ToString(item, CultureInfo.InvariantCulture));
            }
            return values;
        }

        internal static List<Point> PointList(IDictionary<string, object> dictionary, string key)
        {
            List<Point> points = new List<Point>();
            foreach (object rawPoint in List(dictionary, key))
            {
                IDictionary<string, object> pointObject = rawPoint as IDictionary<string, object>;
                if (pointObject != null)
                {
                    points.Add(new Point(Int(pointObject, "x"), Int(pointObject, "y")));
                    continue;
                }

                IEnumerable coordinates = rawPoint as IEnumerable;
                if (coordinates != null && !(rawPoint is string))
                {
                    List<int> pair = new List<int>();
                    foreach (object coordinate in coordinates)
                    {
                        pair.Add(Convert.ToInt32(coordinate, CultureInfo.InvariantCulture));
                    }
                    if (pair.Count >= 2) points.Add(new Point(pair[0], pair[1]));
                }
            }
            return points;
        }
    }
}
