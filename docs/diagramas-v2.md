# Diagramas do sistema · v2

Nesta versão a coleta biométrica (UC2) e a detecção de padrões repetitivos (UC3) estão separadas em todos os diagramas.

Atores:

| Ator | Login | O que pode fazer |
|---|---|---|
| Dono do haras (admin) | `admin` | Tudo |
| Veterinário | `veterinario` | Ver tudo; mudar nutrição e características do cavalo |
| Dono do cavalo | `dono` | Ver tudo; mudar a intensidade do treino (easy, medium, hard) |
| Tag BLE (Google Find Hub) | — | Ator externo: informa a posição do cavalo |
| Sensor ESP32 | — | Ator externo: mede e envia biometria e movimento, e detecta os padrões |

Os casos de uso que todos os logins fazem estão ligados ao ator **Usuário**, a generalização dos três acessos.

---

## UC1 · Tela de Localização

```mermaid
flowchart LR
    U(["👤 Usuário"])
    VET(["👤 Veterinário"]) -.->|é um| U
    DONO(["👤 Dono do cavalo"]) -.->|é um| U
    ADM(["👤 Dono do haras<br/>(admin)"]) -.->|é um| U
    TAG(["📡 Tag BLE<br/>Google Find Hub"])
    ESP(["📟 Sensor ESP32"])

    subgraph SIS["Portal · Localização"]
        direction TB
        UC1(["Ver trajeto no mapa"])
        UC2(["Filtrar período<br/>(hoje, 7 dias, 30 dias)"])
        UC3(["Ver posição atual<br/>e precisão"])
        UC4(["Ver deslocamento:<br/>distância, velocidade média,<br/>aceleração"])
        UC5(["Consultar a tag agora"])
        UC6(["Definir cerca virtual<br/>(centro e raio)"])
        UC7(["Receber posições<br/>(a cada ~10 min)"])
        UC8(["Alertar saída da cerca"])
        UC9(["Ver alerta no sino"])
    end

    U --- UC1
    U --- UC3
    U --- UC5
    U --- UC9
    ADM --- UC6
    TAG --- UC7
    TAG --- UC5

    UC1 -.->|«include»| UC2
    UC1 -.->|«include»| UC4
    UC4 -.->|«include»| UC2
    UC7 -.->|«extend»<br/>posição fora do raio| UC8
    UC8 -.->|«include»| UC9
    UC8 --- ESP
```

| Caso de uso | Ator | Descrição |
|---|---|---|
| Ver trajeto no mapa | Usuário | O mapa mostra os pontos do período, ligados em ordem de tempo |
| Filtrar período | Usuário | Seleção de hoje, 7 dias ou 30 dias; vale para o trajeto e o deslocamento |
| Ver posição atual e precisão | Usuário | Pino com o último ponto, a precisão (± m) e há quanto tempo foi visto |
| Ver deslocamento | Usuário | Cartão flutuante com distância, velocidade média e aceleração do período |
| Consultar a tag agora | Usuário, Tag | Pede a posição à rede Find Hub sem esperar o ciclo de 10 min |
| Definir cerca virtual | Admin | Arrastar o mapa para o centro e escolher o raio (30 a 1000 m) |
| Receber posições | Tag | O servidor consulta a tag a cada ~10 min e descarta pontos imprecisos ou impossíveis |
| Alertar saída da cerca | Sistema | Com a posição fora do raio, o alerta vai para o sino e o sensor ESP32 avisa com o LED |
| Ver alerta no sino | Usuário | Lista de alertas; tocar abre a tela do cavalo |

---

## UC2 · Biometria (coleta e alerta dos sinais)

```mermaid
flowchart LR
    U(["👤 Usuário"])
    VET(["👤 Veterinário"]) -.->|é um| U
    DONO(["👤 Dono do cavalo"]) -.->|é um| U
    ADM(["👤 Dono do haras<br/>(admin)"]) -.->|é um| U
    ESP(["📟 Sensor ESP32"])

    subgraph SIS["Portal · Biometria"]
        direction TB
        C1(["Medir batimentos,<br/>temperatura e movimento"])
        C2(["Enviar leituras<br/>(a cada 5 min)"])
        C3(["Ver curvas<br/>(dia e intervalo)"])
        C6(["Baixar limites<br/>e calibração"])
        C9(["Definir limites de alerta<br/>e calibrar sinais"])
        C10(["Alertar sinal fora do limite<br/>(LED 1 s, sino, e-mail)"])
        C11(["Ver ao vivo<br/>(botão do sensor)"])
    end

    ESP --- C1
    ESP --- C2
    ESP --- C6
    U --- C3
    U --- C11
    ADM --- C9

    C1 -.->|«include»| C2
    C6 -.->|«include»| C2
    C1 -.->|«extend»<br/>valor fora do limite| C10
    C11 -.->|«include»| C1
```

| Caso de uso | Ator | Descrição |
|---|---|---|
| Medir batimentos, temperatura e movimento | ESP32 | MAX30102 a 25 leit./s, temperatura no intervalo configurado, acelerômetro e giroscópio a 50 leit./s |
| Enviar leituras | ESP32 | Envia a cada 5 min; se falhar, guarda no cartão SD e manda no próximo envio |
| Ver curvas | Usuário | Biometria: bpm e °C. Atividade: intensidade e X, Y, Z, com dia e intervalo de tempo |
| Baixar limites e calibração | ESP32 | Junto do envio: só baixa se a versão mudou |
| Definir limites de alerta e calibrar | Admin | Mínimo, máximo e frequência por sensor; prévia da curva calibrada com os limites em vermelho |
| Alertar sinal fora do limite | Sistema | LED pisca 1 s; o alerta fica no sino do portal e o veterinário recebe e-mail |
| Ver ao vivo | Usuário | Apertar o botão do sensor abre a página ao vivo na rede Wi-Fi; desliga após 3 min sem ninguém |

---

## UC3 · Detecção de padrões repetitivos (Pulo, Volta…)

```mermaid
flowchart LR
    U(["👤 Usuário"])
    VET(["👤 Veterinário"]) -.->|é um| U
    DONO(["👤 Dono do cavalo"]) -.->|é um| U
    ADM(["👤 Dono do haras<br/>(admin)"]) -.->|é um| U
    ESP(["📟 Sensor ESP32"])

    subgraph SIS["Portal · Atividade"]
        direction TB
        P4(["Marcar trecho de um padrão<br/>(Pulo, Volta…) e eixos"])
        P5(["Treinar o modelo"])
        P6(["Baixar o modelo"])
        P7(["Detectar padrão<br/>no sensor"])
        P2(["Enviar eventos<br/>(a cada 5 min)"])
        P8(["Ver contadores e eventos"])
        P10(["Alertar padrão repetido<br/>(LED 1 s, sino, e-mail)"])
    end

    ESP --- P6
    ESP --- P7
    ESP --- P2
    U --- P8
    ADM --- P4
    ADM --- P5

    P5 -.->|«include»| P4
    P6 -.->|«include»| P2
    P7 -.->|«include»| P2
    P7 -.->|«extend»<br/>N detecções em M min| P10
```

| Caso de uso | Ator | Descrição |
|---|---|---|
| Marcar trecho de um padrão | Admin | No gráfico de 30 s, arrastar o trecho, escolher os eixos e o padrão |
| Treinar o modelo | Admin | O servidor gera o modelo e mostra acertos e falsos alarmes por hora |
| Baixar o modelo | ESP32 | Junto do envio: só baixa se a versão mudou |
| Detectar padrão no sensor | ESP32 | Física: pulo por queda livre (≥ 5 cm), volta pelo giro ou pela rotação do vetor X/Y |
| Enviar eventos | ESP32 | Cada detecção vira um evento com o código do padrão e vai junto das leituras |
| Ver contadores e eventos | Usuário | Contadores por padrão no dia e lista de eventos com horário |
| Alertar padrão repetido | Sistema | Com N detecções em M minutos, LED pisca 1 s; o alerta fica no sino e o veterinário recebe e-mail |

---

## Diagramas de sequência

### SD1 · Localização: posição da tag, tela e alerta de cerca

```mermaid
sequenceDiagram
    autonumber
    participant TAG as Tag BLE / Find Hub
    participant POL as Poller (servidor)
    participant DB as Banco
    actor U as Usuário
    participant WEB as Portal (SPA)
    participant API as API FastAPI
    participant ESP as Sensor ESP32

    loop a cada ~10 min
        POL->>TAG: pede a localização da tag
        TAG-->>POL: relatórios (lat, lon, precisão, hora)
        POL->>POL: descarta precisão > 100 m e velocidade > 60 km/h
        POL->>DB: grava Position
    end

    U->>WEB: abre a tela Localização do cavalo
    WEB->>API: GET /horses/{id} (JWT)
    WEB->>API: GET /horses/{id}/positions?from&to
    API->>DB: posições do período
    API-->>WEB: trajeto + distância
    WEB->>API: GET /horses/{id}/positions/latest
    API-->>WEB: última posição + dentro/fora da cerca
    WEB->>API: GET /horses/{id}/positions/stats?from&to
    API-->>WEB: distância, velocidade média, aceleração
    WEB-->>U: mapa, pino, cerca e cartão de deslocamento

    opt Consultar a tag agora
        U->>WEB: toca em atualizar
        WEB->>API: POST /horses/{id}/poll
        API->>TAG: pede a localização
        TAG-->>API: relatórios
        API->>DB: grava Position
        API-->>WEB: {saved: n}
    end

    opt Definir cerca (admin)
        U->>WEB: arrasta o mapa e escolhe o raio
        WEB->>API: PATCH /horses/{id} {fence_lat, fence_lon, fence_radius_m}
        API->>API: confere o papel (403 se não for admin)
        API->>DB: grava a cerca
    end

    Note over ESP,API: no envio seguinte do sensor
    ESP->>API: GET /device/alerts?ver=N
    API->>DB: última posição × cerca
    API-->>ESP: 204 ou arquivo + X-Cerca: distância/raio
    ESP->>ESP: LED pisca 1 s
    ESP->>API: POST /device/alert {kind: C}
    API->>DB: grava SensorAlert
    API-->>U: alerta no sino (e e-mail ao veterinário)
```

### SD2 · Biometria: coleta, envio e alerta

```mermaid
sequenceDiagram
    autonumber
    participant SEN as Sensores (MPU6050, MAX30102, DHT)
    participant ESP as ESP32
    participant SD as Cartão SD
    participant API as API FastAPI
    participant DB as Banco
    actor ADM as Admin
    participant WEB as Portal (SPA)

    ADM->>WEB: Limites de alerta: mínimo, máximo, frequência, calibração
    WEB->>API: PUT /horses/{id}/sensor/alerts e /sensor/settings
    API->>DB: grava os limites (alert_ver + 1)

    loop a cada 500 ms (light sleep)
        ESP->>SEN: lê o FIFO do acelerômetro, o pulso e a temperatura
        ESP->>ESP: compara com os limites (bpm, °C, movimento)
        alt fora do limite
            ESP->>ESP: LED pisca 1 s e marca alerta pendente
        end
        ESP->>SD: blocos de leituras (a cada 60 s)
    end

    loop a cada 5 min (upload_s)
        ESP->>ESP: liga o Wi-Fi
        opt alerta pendente
            ESP->>API: POST /device/alert
            API->>DB: grava SensorAlert
            API->>API: e-mail ao veterinário (se SMTP configurado)
        end
        loop blocos ainda não enviados
            ESP->>SD: lê a partir do marcador
            ESP->>API: POST /device/upload (X-Sensor: MAC)
            API->>DB: grava SensorBlock (zlib)
            API-->>ESP: 200
            ESP->>SD: avança o marcador
        end
        ESP->>API: GET /device/alerts?ver=N
        API-->>ESP: 204 ou novos limites, frequências e calibração
        ESP->>SD: grava /alertas.txt
        ESP->>ESP: desliga o Wi-Fi
    end

    WEB->>API: GET /horses/{id}/sensor/series?kind=H|T|A
    API->>DB: blocos do período
    API-->>WEB: curvas com a calibração aplicada
```

### SD3 · Detecção de padrões repetitivos

```mermaid
sequenceDiagram
    autonumber
    participant SEN as MPU6050
    participant ESP as ESP32
    participant SD as Cartão SD
    participant API as API FastAPI
    participant DB as Banco
    actor ADM as Admin
    participant WEB as Portal (SPA)

    ADM->>WEB: toca no gráfico e arrasta o trecho (Pulo, Volta…)
    WEB->>API: POST /motion/labels {padrão, cavalo, de, até, eixos}
    API->>DB: grava PatternLabel
    ADM->>WEB: Treinar
    WEB->>API: POST /motion/train
    API->>DB: lê os blocos dos trechos marcados
    API->>API: treina e empacota (CVM1)
    API->>DB: grava MotionModel (ver M+1)
    API-->>WEB: acertos e falsos alarmes por hora

    Note over ESP,API: no envio seguinte do sensor
    ESP->>API: GET /device/model?ver=M
    API-->>ESP: 204 ou /modelo.bin
    ESP->>SD: grava /modelo.bin

    loop a cada 500 ms (light sleep)
        ESP->>SEN: lê o FIFO do acelerômetro e do giroscópio
        ESP->>ESP: física: queda livre → Pulo, giro 360° → Volta
        ESP->>SD: evento com o código do padrão
        alt N detecções em M min
            ESP->>ESP: LED pisca 1 s e marca alerta pendente
        end
    end

    loop a cada 5 min (upload_s)
        opt alerta pendente
            ESP->>API: POST /device/alert {kind: P, code}
            API->>DB: grava SensorAlert
        end
        ESP->>API: POST /device/upload (eventos junto das leituras)
        API->>DB: grava SensorBlock (E)
    end

    WEB->>API: GET /horses/{id}/sensor/detections
    API->>DB: eventos do dia por padrão
    API-->>WEB: contadores e lista de eventos
```

---

## Diagrama de classes (banco de dados)

```mermaid
classDiagram
    direction LR

    class Horse {
        +int id
        +str name
        +str breed
        +float weight_kg
        +str sex  M F C
        +date birth_date
        +str coat
        +str notes
        +float height_cm
        +float girth_cm
        +float length_cm
        +float cannon_cm
        +str training_level  easy medium hard
        +str tag_id
        +str sensor_id  MAC
        +float fence_lat
        +float fence_lon
        +float fence_radius_m
        +float alert_bpm_min
        +float alert_bpm_max
        +float alert_temp_min
        +float alert_temp_max
        +float alert_mov_max
        +int alert_ver
        +int sensor_accel_hz
        +int sensor_upload_s
        +int sensor_temp_s
        +float sensor_temp_offset
        +float sensor_bpm_offset
        +float sensor_mov_gain
        +str sensor_rot  matriz 3x3
    }

    namespace Localizacao {
        class Position {
            +int id
            +int horse_id
            +int ts
            +float lat
            +float lon
            +float accuracy
        }
    }

    namespace Biometria {
        class SensorBlock {
            +int id
            +int horse_id
            +str kind  A H T E
            +int boot
            +int ts_ms
            +int dur_ms
            +int n
            +int ch
            +float scale
            +float v_min
            +float v_max
            +float v_avg
            +bytes data  zlib
        }
        class SensorAlert {
            +int id
            +int horse_id
            +int ts
            +str kind  H T A C P
            +float value
            +float limit
            +int code
            +str email
            +bool emailed
        }
    }

    namespace Padroes {
        class Pattern {
            +int id
            +str name
            +int alert_n
            +int alert_min
        }
        class PatternLabel {
            +int id
            +int pattern_id
            +int horse_id
            +int from_ms
            +int to_ms
            +str axes
        }
        class MotionModel {
            +int id
            +int ver
            +int created
            +str metrics  JSON
            +bytes blob  CVM1
        }
    }

    namespace Nutricao {
        class Meal {
            +int id
            +int horse_id
            +int weekday  0-6
            +str shift  M T N
            +str time
            +float kg
            +int x
            +int y
            +int z
        }
    }

    class Usuario {
        <<JWT>>
        +str username
        +str role  admin veterinario dono
    }

    Horse "1" --> "*" Position : trajeto
    Horse "1" --> "*" SensorBlock : leituras
    Horse "1" --> "*" SensorAlert : alertas
    Horse "1" --> "*" Meal : nutrição
    Horse "1" --> "*" PatternLabel : marcações
    Pattern "1" --> "*" PatternLabel : exemplos
    PatternLabel ..> MotionModel : treina
    SensorBlock ..> PatternLabel : trechos marcados
    Usuario ..> Horse : vê / altera conforme o papel
```

As tabelas estão agrupadas por parte do sistema: **Localização** (UC1), **Biometria** (UC2), **Padrões** (UC3) e **Nutrição**. O `SensorAlert` é compartilhado: guarda os alertas de sinal (H, T, A), de cerca (C) e de padrão (P). Os eventos de padrão chegam como `SensorBlock` do tipo E.

`Usuario` não é tabela: os três logins são fixos na configuração do servidor e o papel vai dentro do JWT.

---

## Fluxograma do firmware (ESP32)

O firmware tem quatro partes: a inicialização (`setup`), o laço principal (`loop`, com o envio), o ciclo de leitura da biometria, que roda a cada 500 ms, e a detecção de padrões, que roda em cada leitura do acelerômetro.

### 1 · Inicialização

```mermaid
flowchart TD
    A([Liga ou reinicia]) --> B[Vigia de 30 s, CPU a 80 MHz,<br/>Bluetooth e Wi-Fi desligados]
    B --> C[ID do sensor = MAC<br/>ID do boot]
    C --> D[Destrava o barramento I2C]
    D --> E{Cartão SD?}
    E -- não --> E1[Espera 2 s] --> E
    E -- sim --> F[Lê config.txt, /alertas.txt<br/>e /modelo.bin]
    F --> G[Novo arquivo de log<br/>e marcador do envio]
    G --> H{MAX30102 responde?}
    H -- não --> H1[Tenta de novo<br/>a cada 30 s]
    H -- sim --> I{Sensor de<br/>temperatura?}
    H1 --> I
    I -- não --> I1[Tenta de novo<br/>a cada 60 s]
    I -- sim --> J{MPU6050 responde?<br/>até 5 tentativas}
    I1 --> J
    J -- não --> J1[Segue sem acelerômetro,<br/>tenta a cada 30 s]
    J -- sim --> K[Botão G16, LED G17,<br/>evento BOOT]
    J1 --> K
    K --> L([Vai para o loop])
```

### 2 · Laço principal e envio

```mermaid
flowchart TD
    L([loop]) --> M{Modo ao vivo?}

    M -- não --> N[Light sleep até o próximo<br/>ciclo ou o botão]
    N --> O{Hora do ciclo?}
    O -- sim --> CY[[Ciclo de leitura]]
    O -- não --> BT
    CY --> BT[Confere o botão<br/>debounce 1,5 s]
    BT --> LB{Botão apertado?}
    LB -- sim --> LV[Entra no ao vivo: liga o Wi-Fi,<br/>LED pisca até alguém conectar]
    LB -- não --> UP
    LV --> UP

    M -- sim --> P[Ciclo curto, página web<br/>e WebSocket]
    P --> Q{3 min sem ninguém<br/>ou botão?}
    Q -- sim --> Q1[Sai do ao vivo,<br/>desliga o Wi-Fi]
    Q -- não --> UP
    Q1 --> UP

    UP{Hora do envio?<br/>a cada 5 min}
    UP -- não --> L
    UP -- sim --> W{Wi-Fi conectou?}
    W -- não --> W1[Dados ficam no SD,<br/>tenta no próximo envio] --> L
    W -- sim --> W2[Alerta pendente:<br/>POST /device/alert]
    W2 --> W3[Blocos do SD a partir do marcador:<br/>POST /device/upload]
    W3 --> W4[GET /device/alerts:<br/>limites, frequências,<br/>calibração e cerca]
    W4 --> W5[GET /device/model:<br/>/modelo.bin]
    W5 --> W6{Frequência do<br/>acelerômetro mudou?}
    W6 -- sim --> W7([Grava o log e reinicia])
    W6 -- não --> W8[Desliga o Wi-Fi<br/>fora do ao vivo] --> L
```

### 3 · Ciclo de leitura: biometria (a cada 500 ms)

```mermaid
flowchart TD
    C0([Acorda]) --> C1[Lê o FIFO do MPU6050:<br/>acelerômetro e giroscópio a 50/s]
    C1 --> PD[[Detecção de padrões]]
    PD --> C3[Movimento: média de 10 s<br/>comparada ao limite]
    C3 --> C4[MAX30102: pulso → bpm<br/>+ ajuste, comparado ao limite]
    C4 --> C5[Temperatura no intervalo<br/>+ ajuste, comparada ao limite]
    C5 --> C6{Fora do limite?}
    C6 -- sim --> C7[LED pisca 1 s,<br/>alerta pendente e envio antecipado]
    C6 -- não --> C8
    C7 --> C8{60 s desde a<br/>última gravação?}
    C8 -- sim --> C9[Grava os blocos<br/>no cartão SD]
    C8 -- não --> C10([Volta a dormir])
    C9 --> C10
```

### 4 · Detecção de padrões repetitivos (cada leitura do acelerômetro)

```mermaid
flowchart TD
    A0([Leitura do acelerômetro<br/>e do giroscópio]) --> A1[Mede a gravidade<br/>quando o sensor está parado]
    A1 --> A2{Módulo < 0,6 g?<br/>queda livre}
    A2 -- sim --> A3[Conta o tempo no ar]
    A2 -- não --> A4{Estava no ar?}
    A3 --> V1
    A4 -- sim --> A5[Altura = 9,81 · T² / 8]
    A5 --> A6{Altura ≥ 5 cm?}
    A6 -- sim --> A7[Pulo detectado]
    A6 -- não --> V1
    A4 -- não --> V1
    A7 --> V1

    V1[Giro no eixo da gravidade<br/>+ rotação do vetor X/Y] --> V2{Somou 360°?}
    V2 -- não --> FIM([Próxima leitura])
    V2 -- sim --> V3{Movimento plano<br/>e ≥ 0,8 s por volta?}
    V3 -- não --> FIM
    V3 -- sim --> V4[Volta detectada]
    V4 --> D1
    A7 --> D1

    D1[Grava evento com o código<br/>soma no contador<br/>avisa a página ao vivo] --> D2{N detecções<br/>em M min?}
    D2 -- sim --> D3[LED pisca 1 s,<br/>alerta P pendente]
    D2 -- não --> FIM
    D3 --> FIM
```
