"""Transformer thermal model: IEC 60076-7 difference equations.

    D(theta_o)   = Dt/(k11*tau_o) * [ ((1+K^2 R)/(1+R))^x * d_theta_or - (theta_o - theta_a) ]
    D(d_h1)      = Dt/(k22*tau_w) * [ k21 * d_theta_hr * K^y - d_h1 ]
    D(d_h2)      = Dt/(tau_o/k22) * [ (k21-1) * d_theta_hr * K^y - d_h2 ]
    theta_h      = theta_o + d_h1 - d_h2
    V            = 2^((theta_h - 98)/6)          (non-thermally-upgraded paper)

Parameter defaults are the IEC 60076-7 values for ONAN distribution
transformers. Citations for every constant live in docs/sources.md.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ThermalParams:
    d_theta_or: float = 55.0  # top-oil rise at rated load, K
    d_theta_hr: float = 23.0  # hot-spot-to-top-oil gradient at rated load, K
    R: float = 5.0  # load losses / no-load losses at rated current
    x: float = 0.8  # oil exponent
    y: float = 1.6  # winding exponent
    k11: float = 1.0
    k21: float = 1.0
    k22: float = 2.0
    tau_o: float = 180.0  # oil time constant, min
    tau_w: float = 4.0  # winding time constant, min

    @classmethod
    def from_config(cls, cfg: dict | None) -> "ThermalParams":
        cfg = cfg or {}
        names = cls.__dataclass_fields__.keys()
        return cls(**{k: float(v) for k, v in cfg.items() if k in names})


@dataclass
class ThermalResult:
    top_oil: list[float] = field(default_factory=list)
    hot_spot: list[float] = field(default_factory=list)
    ageing_rate: list[float] = field(default_factory=list)
    loss_of_life_h: float = 0.0  # equivalent hours of insulation life consumed
    elapsed_h: float = 0.0

    @property
    def max_hot_spot(self) -> float:
        return max(self.hot_spot) if self.hot_spot else 0.0

    @property
    def excess_loss_h(self) -> float:
        """Life consumed beyond normal ageing (V = 1) over the same period."""
        return max(0.0, self.loss_of_life_h - self.elapsed_h)


def ageing_rate(theta_h: float) -> float:
    return 2.0 ** ((theta_h - 98.0) / 6.0)


def steady_state(K: float, theta_a: float, p: ThermalParams) -> tuple[float, float]:
    """(top-oil, hot-spot) temperatures at constant load factor K."""
    top = theta_a + p.d_theta_or * ((1 + K * K * p.R) / (1 + p.R)) ** p.x
    return top, top + p.d_theta_hr * K**p.y


def simulate(
    load_factor: list[float],
    ambient: list[float] | float,
    p: ThermalParams | None = None,
    dt_min: float = 1.0,
    initial: tuple[float, float] | None = None,
) -> ThermalResult:
    """Run the difference equations over a load-factor series (K = S / S_rated).

    `dt_min` must be at most half the smallest time constant (IEC 60076-7);
    larger steps are subdivided automatically.
    """
    p = p or ThermalParams()
    n = len(load_factor)
    amb = [float(ambient)] * n if isinstance(ambient, (int, float)) else list(ambient)
    sub = 1
    while dt_min / sub > min(p.tau_w, p.tau_o) / 2.0:
        sub += 1
    dt = dt_min / sub

    k0, a0 = (load_factor[0], amb[0]) if n else (0.0, 20.0)
    if initial is None:
        theta_o, _ = steady_state(k0, a0, p)
        d_h1 = p.k21 * p.d_theta_hr * k0**p.y
        d_h2 = (p.k21 - 1) * p.d_theta_hr * k0**p.y
    else:
        theta_o = initial[0]
        # split the initial gradient in the steady-state proportion k21 : (k21 - 1)
        grad = initial[1] - initial[0]
        d_h1, d_h2 = p.k21 * grad, (p.k21 - 1) * grad

    res = ThermalResult()
    for i in range(n):
        K, theta_a = max(0.0, load_factor[i]), amb[i]
        for _ in range(sub):
            target = ((1 + K * K * p.R) / (1 + p.R)) ** p.x * p.d_theta_or
            theta_o += dt / (p.k11 * p.tau_o) * (target - (theta_o - theta_a))
            ky = K**p.y
            d_h1 += dt / (p.k22 * p.tau_w) * (p.k21 * p.d_theta_hr * ky - d_h1)
            d_h2 += dt / (p.tau_o / p.k22) * ((p.k21 - 1) * p.d_theta_hr * ky - d_h2)
            v = ageing_rate(theta_o + d_h1 - d_h2)
            res.loss_of_life_h += v * dt / 60.0
        theta_h = theta_o + d_h1 - d_h2
        res.top_oil.append(theta_o)
        res.hot_spot.append(theta_h)
        res.ageing_rate.append(ageing_rate(theta_h))
    res.elapsed_h = n * dt_min / 60.0
    return res


def life_cost_paise(life_hours: float, transformer_cost_paise: int, normal_life_h: float) -> int:
    """Rupee value (in paise) of `life_hours` of insulation life."""
    if normal_life_h <= 0:
        return 0
    return int(round(life_hours / normal_life_h * transformer_cost_paise))
