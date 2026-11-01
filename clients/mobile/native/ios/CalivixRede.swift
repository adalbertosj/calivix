// ==== Calivix: CalivixRede ====
// (o patch-native.mjs acrescenta este trecho ao AppDelegate.swift: assim não é preciso mexer no projeto do Xcode)
// O Capacitor o carrega por estar em packageClassList (capacitor.config.json do iOS).
// Dá à interface o que o WebView não tem: sockets TCP para falar ADB com as TVs, varredura da rede local,
// informações da rede Wi-Fi e HTTP para os aparelhos da rede. Mesmo contrato do app de computador.
import Network

@objc(CalivixRedePlugin)
public class CalivixRedePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalivixRedePlugin"
    public let jsName = "CalivixRede"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tcpConectar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpEscrever", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpFechar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sondar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "infoRede", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "httpGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abrir", returnType: CAPPluginReturnPromise),
    ]

    private let fila = DispatchQueue(label: "calivix.rede")
    private var conexoes: [Int: NWConnection] = [:]
    private var proximo = 1
    private var monitor: NWPathMonitor?
    private var ultimaRede = ""

    override public func load() {
        let m = NWPathMonitor()
        m.pathUpdateHandler = { [weak self] _ in
            guard let self = self else { return }
            let r = self.lerRede()["ip"] as? String ?? ""
            if r != self.ultimaRede { self.ultimaRede = r; self.notifyListeners("rede", data: [:]) }
        }
        m.start(queue: fila)
        monitor = m
    }

    // ---------- sockets TCP (ADB) ----------
    @objc func tcpConectar(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let porta = call.getInt("porta"), let p = NWEndpoint.Port(rawValue: UInt16(porta)) else {
            return call.reject("Endereço inválido")
        }
        let ms = call.getInt("ms") ?? 8000
        let tcp = NWProtocolTCP.Options(); tcp.noDelay = true; tcp.connectionTimeout = max(1, ms / 1000)
        let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: NWParameters(tls: nil, tcp: tcp))
        var id = 0
        var respondido = false
        fila.sync { id = proximo; proximo += 1 }
        let falhar: (String) -> Void = { msg in
            if !respondido { respondido = true; call.reject(msg) }
        }
        let prazo = DispatchWorkItem { c.cancel(); falhar("Sem resposta de \(host):\(porta)") }
        fila.asyncAfter(deadline: .now() + .milliseconds(ms), execute: prazo)
        c.stateUpdateHandler = { [weak self] estado in
            guard let self = self else { return }
            switch estado {
            case .ready:
                prazo.cancel()
                if !respondido { respondido = true; self.conexoes[id] = c; self.receber(id, c); call.resolve(["id": id]) }
            case .waiting(let e), .failed(let e):
                if !respondido {
                    prazo.cancel(); c.cancel()
                    if case .posix(let code) = e, code == .ECONNREFUSED { falhar("\(host) recusou a porta \(porta): a depuração pela rede está desligada na TV") }
                    else { falhar("\(host) não está alcançável desta rede") }
                } else if case .failed = estado { self.fechou(id, e.localizedDescription) }
            case .cancelled:
                if respondido { self.fechou(id, nil) }
            default: break
            }
        }
        c.start(queue: fila)
    }

    private func receber(_ id: Int, _ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] dados, _, fim, erro in
            guard let self = self else { return }
            if let d = dados, !d.isEmpty { self.notifyListeners("dados", data: ["id": id, "dados": d.base64EncodedString()]) }
            if fim || erro != nil { self.fechou(id, erro?.localizedDescription); c.cancel(); return }
            self.receber(id, c)
        }
    }

    private func fechou(_ id: Int, _ erro: String?) {
        guard conexoes.removeValue(forKey: id) != nil else { return }
        var d: [String: Any] = ["id": id]
        if let e = erro { d["erro"] = e }
        notifyListeners("fechado", data: d)
    }

    @objc func tcpEscrever(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0
        guard let b64 = call.getString("dados"), let dados = Data(base64Encoded: b64) else { return call.reject("Dados inválidos") }
        fila.async {
            guard let c = self.conexoes[id] else { return call.reject("conexão fechada") }
            c.send(content: dados, completion: .contentProcessed { e in if let e = e { call.reject(e.localizedDescription) } else { call.resolve() } })
        }
    }

    @objc func tcpFechar(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? 0
        fila.async { if let c = self.conexoes.removeValue(forKey: id) { c.cancel() }; call.resolve() }
    }

    // ---------- descoberta ----------
    private func portaAberta(_ host: String, _ porta: Int, _ ms: Int, _ fim: @escaping (Bool) -> Void) {
        guard let p = NWEndpoint.Port(rawValue: UInt16(porta)) else { return fim(false) }
        let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: .tcp)
        var feito = false
        let acabar: (Bool) -> Void = { ok in if !feito { feito = true; c.cancel(); fim(ok) } }
        c.stateUpdateHandler = { estado in
            switch estado {
            case .ready: acabar(true)
            case .failed, .waiting: acabar(false)
            default: break
            }
        }
        c.start(queue: fila)
        fila.asyncAfter(deadline: .now() + .milliseconds(ms)) { acabar(false) }
    }

    @objc func sondar(_ call: CAPPluginCall) {
        let hosts = call.getArray("hosts", String.self) ?? []
        let portas = call.getArray("portas", Int.self) ?? []
        let ms = call.getInt("ms") ?? 600
        let grupo = DispatchGroup()
        var achados: [String: [Int]] = [:]
        for h in hosts {
            achados[h] = []
            for p in portas {
                grupo.enter()
                portaAberta(h, p, ms) { ok in
                    if ok { achados[h]?.append(p) }  // roda na mesma fila serial
                    grupo.leave()
                }
            }
        }
        grupo.notify(queue: fila) {
            call.resolve(["itens": hosts.map { ["host": $0, "portas": (achados[$0] ?? []).sorted()] }])
        }
    }

    private func lerRede() -> [String: Any] {
        var lista: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&lista) == 0, let primeira = lista else { return ["ip": NSNull()] }
        defer { freeifaddrs(lista) }
        var achado: [String: Any]? = nil
        for p in sequence(first: primeira, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard let end = i.ifa_addr, end.pointee.sa_family == UInt8(AF_INET), let masc = i.ifa_netmask else { continue }
            let nome = String(cString: i.ifa_name)
            guard nome.hasPrefix("en") else { continue }  // Wi-Fi (en0) ou cabo; ignora a Tailnet (utun) e o celular (pdp_ip)
            func texto(_ a: UnsafeMutablePointer<sockaddr>) -> String {
                var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(a, socklen_t(a.pointee.sa_len), &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST)
                return String(cString: buf)
            }
            let ip = texto(end)
            let n = ip.split(separator: ".").compactMap { Int($0) }
            guard n.count == 4, n[0] == 10 || (n[0] == 172 && n[1] >= 16 && n[1] < 32) || (n[0] == 192 && n[1] == 168) else { continue }
            achado = ["ip": ip, "mascara": texto(masc), "interface": nome]
            if nome == "en0" { break }
        }
        return achado ?? ["ip": NSNull()]
    }

    @objc func infoRede(_ call: CAPPluginCall) { call.resolve(lerRede()) }

    @objc func httpGet(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), s.range(of: #"^http://(10|172|192)\.[\d.]+:\d+/"#, options: .regularExpression) != nil else {
            return call.reject("Só endereços da rede local")
        }
        var req = URLRequest(url: url); req.timeoutInterval = Double(call.getInt("ms") ?? 3000) / 1000
        URLSession.shared.dataTask(with: req) { dados, resp, erro in
            if let e = erro { return call.reject(e.localizedDescription) }
            call.resolve(["status": (resp as? HTTPURLResponse)?.statusCode ?? 0, "texto": String(data: dados ?? Data(), encoding: .utf8) ?? ""])
        }.resume()
    }

    @objc func abrir(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), ["http", "https"].contains(url.scheme ?? "") else { return call.reject("Endereço inválido") }
        DispatchQueue.main.async { UIApplication.shared.open(url); call.resolve() }
    }
}
